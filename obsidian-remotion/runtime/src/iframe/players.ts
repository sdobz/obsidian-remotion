/**
 * Component rendering module - simplified
 * Manages React component rendering without Remotion Players
 */

import React from "react";
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
  private __root: any = null;

  constructor(
    private DOM: { playersContainer: HTMLElement },
    private sendMessage: (msg: any) => void,
  ) { }

  renderAll(components: ComponentInfo[]): void {
    const root = createRoot(this.DOM.playersContainer);

    if (!this.__root) {
      this.__root = root;
    }

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
    this.__root.render(element);

    this.hasContent = true;
    this.reposition();
  }

  reposition(): void {
    const playerElements = Array.from(
      this.DOM.playersContainer.children,
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
      const playerElements = Array.from(this.DOM.playersContainer.children);
      const playerStatuses = playerElements.map((el) => {
        const bandIndex = parseInt(
          (el as HTMLElement).getAttribute("data-band-index") || "0",
          10,
        );
        return {
          index: bandIndex,
          height: (el as HTMLElement).offsetHeight || 100,
        };
      });

      const heightsChanged =
        playerStatuses.length !== this.previousHeights.length ||
        playerStatuses.some((s, i) => s.height !== this.previousHeights[i]);

      if (heightsChanged) {
        this.previousHeights = playerStatuses.map((s) => s.height);
        this.sendMessage({ type: "player-status", players: playerStatuses });
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
    if (this.__root) {
      try {
        this.__root.unmount();
      } catch (e) {
        // Ignore unmount errors
      }
      this.__root = null;
    }

    this.DOM.playersContainer.innerHTML = "";
    this.positions = [];
    this.previousHeights = [];
    this.hasContent = false;
  }
}
