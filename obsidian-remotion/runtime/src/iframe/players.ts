/**
 * Player lifecycle module
 * Manages React player rendering, DOM manipulation, lazy loading/unloading, and positioning
 */

import type { NullArray, Band } from "../shared/scroll-math";
import type { Sequence } from "./bundle";

export class PlayerManager {
  private positions: NullArray<Band> = [];
  private previousHeights: number[] = [];
  private hasContent = false;
  private __root: any = null;

  constructor(
    private DOM: { playersContainer: HTMLElement },
    private sendMessage: (msg: any) => void,
  ) { }

  renderAll(sequence: Sequence): void {
    const React = (window as any).require("react");
    const ReactDomClient = (window as any).require("react-dom/client");
    const ReactDom = (window as any).require("react-dom");

    if (!React) {
      throw new Error("Missing React module in runtime");
    }

    // Try react-dom/client first (React 18+), fall back to react-dom
    const root = ReactDomClient?.createRoot
      ? ReactDomClient.createRoot(this.DOM.playersContainer)
      : (ReactDom as any).createRoot?.(this.DOM.playersContainer);

    if (!root) {
      throw new Error("Failed to create React root - ReactDOM unavailable");
    }

    if (!this.__root) {
      this.__root = root;
    }

    const nodes = sequence.scenes.map((scene: any, idx: number) => {
      const props =
        scene.options &&
          typeof scene.options === "object" &&
          !Array.isArray(scene.options)
          ? scene.options
          : {};

      return React.createElement(
        "div",
        {
          key: scene.id,
          "data-scene-id": scene.id,
          "data-band-index": String(idx),
        },
        React.createElement(
          "div",
          { className: "player-wrapper" },
          React.createElement(scene.component as any, props),
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
