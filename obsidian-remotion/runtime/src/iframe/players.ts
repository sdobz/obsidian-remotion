/**
 * Component rendering module - simplified
 * Manages React component rendering without Remotion Players
 */

import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { NullArray, Band } from "../shared/scroll-math";

// Simplified component info
export interface ComponentInfo {
  exportName: string;
  component: unknown;
}

export class PlayerManager {
  private positions: NullArray<Band> = [];
  private previousHeights: number[] = [];
  private hasContent = false;
  private __root: ReturnType<typeof createRoot>;
  /** The actual div that React owns – a child of DOM.playersContainer. */
  private __container: HTMLElement;

  constructor(
    private DOM: { playersContainer: HTMLElement },
    private sendMessage: (msg: any) => void,
  ) {
    // Remove all previous React containers (from prior bundle evals).
    // Each eval creates a new container div so React never reuses a container
    // that was managed by a previous root – this avoids deferred-unmount races.
    this.DOM.playersContainer.innerHTML = "";
    this.__container = this.DOM.playersContainer.ownerDocument.createElement("div");
    this.DOM.playersContainer.appendChild(this.__container);
    this.__root = createRoot(this.__container);
  }

  renderAll(components: ComponentInfo[]): void {
    const nodes = components.map((comp: ComponentInfo, idx: number) => {
      return React.createElement(
        "div",
        {
          key: comp.exportName,
          "data-component-name": comp.exportName,
          "data-band-index": String(idx),
        },
        React.createElement(
          "div",
          { className: "component-wrapper" },
          React.createElement(comp.component as any, {}),
        ),
      );
    });

    const element = React.createElement(React.Fragment, null, ...nodes);
    // flushSync forces React to commit the render synchronously so DOM children
    // are in place immediately (important for scheduleUpdate() and jsdom tests).
    try {
      flushSync(() => this.__root.render(element));
    } catch (_) {
      // Fallback to async render if flushSync is not allowed (e.g. inside another flush)
      this.__root.render(element);
    }

    this.hasContent = true;
    this.reposition();
  }

  reposition(): void {
    const playerElements = Array.from(
      this.__container.children,
    ) as HTMLElement[];

    playerElements.forEach((element, index) => {
      const position = this.positions[index];
      if (position) {
        element.style.position = "absolute";
        const top = position.center - position.height / 2;
        element.style.top = `${top}px`;
        element.style.left = "12px";
        element.style.right = "12px";
        element.style.opacity = "1";
        element.style.display = "block";
        element.style.pointerEvents = "auto";
      } else {
        element.style.display = "none";
        element.style.pointerEvents = "none";
      }
    });
  }

  scheduleUpdate(): void {
    setTimeout(() => {
      const playerElements = Array.from(this.__container.children);
      const heights = playerElements.map(
        (el) => (el as HTMLElement).offsetHeight || 100,
      );

      const heightsChanged =
        heights.length !== this.previousHeights.length ||
        heights.some((h, i) => h !== this.previousHeights[i]);

      if (heightsChanged) {
        this.previousHeights = heights;
        this.sendMessage({
          type: "widget-status",
          widgets: heights.map((height) => ({ height })),
        });
      }
    }, 100);
  }

  handleReflow(newPositions: NullArray<Band>, currentSequence: any): void {
    this.positions = newPositions;

    if (!currentSequence) return;

    this.reposition();
  }

  get playerPositions(): NullArray<Band> {
    return this.positions;
  }

  get contentStatus(): boolean {
    return this.hasContent;
  }

  reset(): void {
    try {
      // flushSync forces the unmount to process synchronously, so React fully
      // tears down the fiber tree before we clear the DOM. Without this, the
      // deferred unmount work can be picked up by the NEXT flushSync call
      // (inside renderAll()) and mutate the detached container in a way that
      // interferes with the new root.
      flushSync(() => this.__root.unmount());
    } catch (e) {
      // ignore errors during reset (e.g. if root was never rendered into)
    }
    this.DOM.playersContainer.innerHTML = "";
    this.positions = [];
    this.previousHeights = [];
    this.hasContent = false;
  }
}
