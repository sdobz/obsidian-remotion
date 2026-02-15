/**
 * Player lifecycle module
 * Manages React player rendering, DOM manipulation, lazy loading/unloading, and positioning
 */

import type { NullArray, Band } from "../editor/scroll-math";
import type { Sequence } from "./bundle";

const DEFAULT_OPTIONS = {
  durationInFrames: 150,
  fps: 30,
  compositionWidth: 1280,
  compositionHeight: 720,
  controls: true,
  loop: false,
  autoPlay: false,
};

export class PlayerManager {
  private positions: NullArray<Band> = [];
  private previousHeights: number[] = [];
  private hasContent = false;
  private __root: any = null;

  constructor(
    private DOM: { playersContainer: HTMLElement },
    private sendMessage: (msg: any) => void,
  ) {}

  renderAll(sequence: Sequence): void {
    const deps = (window as any).__REMOTION_DEPS__ || {};
    const React = deps.react;
    const PlayerModule = deps["@remotion/player"];
    const Player =
      (PlayerModule && PlayerModule.Player) ||
      (PlayerModule && PlayerModule.default) ||
      PlayerModule;
    const ReactDomClient = deps["react-dom/client"] || deps["react-dom"];

    if (!React || !ReactDomClient || !Player) {
      throw new Error("Missing React, ReactDOM, or @remotion/player");
    }

    if (!ReactDomClient.createRoot) {
      throw new Error("Missing react-dom/client createRoot");
    }

    if (!this.__root) {
      this.__root = ReactDomClient.createRoot(this.DOM.playersContainer);
    }

    const nodes = sequence.scenes.map((scene: any, idx: number) => {
      const playerOptions = scene.options
        ? { ...DEFAULT_OPTIONS, ...scene.options }
        : DEFAULT_OPTIONS;

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
          React.createElement(Player, {
            component: scene.component,
            durationInFrames: playerOptions.durationInFrames,
            fps: playerOptions.fps,
            compositionWidth: playerOptions.compositionWidth,
            compositionHeight: playerOptions.compositionHeight,
            controls: playerOptions.controls,
            loop: playerOptions.loop,
            autoPlay: playerOptions.autoPlay,
            acknowledgeRemotionLicense: true,
            style: { width: "100%" },
          }),
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
