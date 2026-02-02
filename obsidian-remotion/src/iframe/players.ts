/**
 * Player lifecycle module
 * Manages React player rendering, DOM manipulation, lazy loading/unloading, and positioning
 */

import type { NullArray, Band } from "../scroll-math";
import type { Sequence } from "./bundle";

const UNLOAD_DEBOUNCE_MS = 300;
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
  private unloadTimers = new Map<number, number>();
  private hasContent = false;
  private __root: any = null;
  private individualRoots = new Map<number, any>();

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

    const createRoot =
      ReactDomClient.createRoot || ReactDomClient.unstable_createRoot;
    if (createRoot && !this.__root) {
      this.__root = createRoot(this.DOM.playersContainer);
    }

    const nodes = sequence.scenes.map((scene: any, idx: number) => {
      const playerOptions = scene.options
        ? { ...DEFAULT_OPTIONS, ...scene.options }
        : DEFAULT_OPTIONS;

      return React.createElement(
        "div",
        { key: scene.id, "data-scene-id": scene.id },
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

    if (this.__root) {
      this.__root.render(React.createElement(React.Fragment, null, ...nodes));
    } else if (ReactDomClient.render) {
      ReactDomClient.render(
        React.createElement(React.Fragment, null, ...nodes),
        this.DOM.playersContainer,
      );
    }

    this.hasContent = true;
    this.reposition();
  }

  renderOne(index: number, scene: any): void {
    const deps = (window as any).__REMOTION_DEPS__ || {};
    const React = deps.react;
    const PlayerModule = deps["@remotion/player"];
    const Player =
      (PlayerModule && PlayerModule.Player) ||
      (PlayerModule && PlayerModule.default) ||
      PlayerModule;

    if (!React || !Player) {
      console.error("Missing React or @remotion/player");
      return;
    }

    const playerOptions = scene.options
      ? { ...DEFAULT_OPTIONS, ...scene.options }
      : DEFAULT_OPTIONS;

    const playerDiv = document.createElement("div");
    playerDiv.setAttribute("data-scene-id", scene.id);
    playerDiv.setAttribute("data-band-index", String(index));

    const playerWrapper = document.createElement("div");
    playerWrapper.className = "player-wrapper";
    playerDiv.appendChild(playerWrapper);

    if (index < this.DOM.playersContainer.children.length) {
      this.DOM.playersContainer.insertBefore(
        playerDiv,
        this.DOM.playersContainer.children[index],
      );
    } else {
      this.DOM.playersContainer.appendChild(playerDiv);
    }

    const ReactDomClient = deps["react-dom/client"] || deps["react-dom"];
    const createRoot =
      ReactDomClient.createRoot || ReactDomClient.unstable_createRoot;

    if (createRoot) {
      const root = createRoot(playerWrapper);
      this.individualRoots.set(index, root);
      root.render(
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
      );
    } else if (ReactDomClient.render) {
      ReactDomClient.render(
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
        playerWrapper,
      );
    }

    const position = this.positions[index];
    if (position) {
      playerDiv.style.position = "absolute";
      const top = position.center - position.height / 2;
      playerDiv.style.top = `${top}px`;
      playerDiv.style.left = "12px";
      playerDiv.style.right = "12px";
    }
  }

  unload(index: number): void {
    const root = this.individualRoots.get(index);
    if (root) {
      try {
        root.unmount();
      } catch (e) {
        // Ignore unmount errors
      }
      this.individualRoots.delete(index);
    }

    const playerElement = this.DOM.playersContainer.children[
      index
    ] as HTMLElement;
    if (playerElement) {
      playerElement.remove();
      if (index < this.previousHeights.length) {
        this.previousHeights[index] = 0;
      }
    }
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

    const playerElements = Array.from(this.DOM.playersContainer.children);

    for (let i = 0; i < currentSequence.scenes.length; i++) {
      const hasBand = newPositions[i] !== null;

      if (hasBand) {
        const timer = this.unloadTimers.get(i);
        if (timer !== undefined) {
          clearTimeout(timer);
          this.unloadTimers.delete(i);
        }

        if (!playerElements[i]) {
          this.renderOne(i, currentSequence.scenes[i]);
        }
      } else {
        if (!this.unloadTimers.has(i) && playerElements[i]) {
          const timer = setTimeout(() => {
            this.unload(i);
            this.unloadTimers.delete(i);
          }, UNLOAD_DEBOUNCE_MS) as unknown as number;
          this.unloadTimers.set(i, timer);
        }
      }
    }

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

    this.individualRoots.forEach((root) => {
      try {
        root.unmount();
      } catch (e) {
        // Ignore unmount errors
      }
    });
    this.individualRoots.clear();

    this.DOM.playersContainer.innerHTML = "";
    this.positions = [];
    this.previousHeights = [];
    this.hasContent = false;
    this.unloadTimers.forEach((timer) => clearTimeout(timer));
    this.unloadTimers.clear();
  }
}
