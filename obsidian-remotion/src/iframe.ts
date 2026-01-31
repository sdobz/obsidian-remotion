/**
 * Iframe runtime script for Remotion preview
 * This runs inside the sandboxed iframe and manages player rendering, scroll sync, and error handling
 */

import type { IframeCommand } from "./preview";
import { PixelBand } from "./scroll";

type Scene = {
  id: string;
  component: unknown;
  options?: Record<string, unknown>;
};

type Sequence = {
  scenes: Scene[];
};

// State management
let hasContent = false;
let playerPositions: PixelBand[] = [];

// Module registry for require polyfill
const __modules__: Record<string, unknown> = {};

// Minimal require polyfill - checks __modules__ and window globals
function require(id: string): unknown {
  if (__modules__[id]) return __modules__[id];
  if ((window as any)[id]) return (window as any)[id];
  if (
    (window as any).__REMOTION_DEPS__ &&
    (window as any).__REMOTION_DEPS__[id]
  )
    return (window as any).__REMOTION_DEPS__[id];
  throw new Error("Module not found: " + id);
}

// Expose require globally so esbuild's bundle can use it
(window as any).require = require;

(window as any).__REMOTION_DEPS__ = (window as any).__REMOTION_DEPS__ || {};
let __root: any = null;

function showLoadingScreen() {
  const loadingScreen = document.getElementById("loading-screen");
  if (loadingScreen) {
    loadingScreen.classList.remove("hidden");
  }
  hasContent = false;
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById("loading-screen");
  if (loadingScreen) {
    loadingScreen.classList.add("hidden");
  }
  hasContent = true;
}

function resetPanel() {
  // Unmount React root before clearing
  if (__root) {
    try {
      __root.unmount();
    } catch (e) {
      // Ignore unmount errors
    }
    __root = null;
  }

  // Clear all state
  const playersEl = document.getElementById("players-wrapper");
  if (playersEl) {
    playersEl.innerHTML = "";
  }
  const bandsEl = document.getElementById("bands-wrapper");
  if (bandsEl) {
    bandsEl.innerHTML = "";
  }
  clearError();

  // Reset status
  hasContent = false;

  // Show loading screen
  showLoadingScreen();
}

function handleReflow(cmd: IframeCommand & { type: "reflow" }) {
  // Update viewport dimensions for preview bands and players containers
  console.log("[iframe] Reflow:", {
    previewHeight: cmd.bandScrollHeight,
    bands: cmd.bands,
    playerScrollHeight: cmd.playerScrollHeight,
    players: cmd.players,
  });

  // Store player positions for rendering
  playerPositions = cmd.players;

  // Set preview bands container height to match editor scroll height
  document.getElementById("bands-wrapper")!.style.height =
    cmd.bandScrollHeight + "px";
  // Set players container height accounting for overlaps
  document.getElementById("players-wrapper")!.style.height =
    cmd.playerScrollHeight + "px";

  renderPreviewBands(cmd.bands);

  // Reposition any existing players with new positions
  repositionPlayers();
}

function handleBundle(cmd: IframeCommand & { type: "bundle" }) {
  if (cmd.payload) {
    loadBundle(cmd.payload);
    // After bundle loads, players should render and send back player-status
  }
}

function handleScroll(cmd: IframeCommand & { type: "scroll" }) {
  // Scroll preview bands container to match editor scroll
  document.getElementById("bands-scroller")!.scrollTop = cmd.bandScrollTop;

  // Scroll players container using matching algorithm
  document.getElementById("players-scroller")!.scrollTop = cmd.playerScrollTop;

  console.log("Player scroll top:", cmd.playerScrollTop);
}

function renderEmptyState(): void {
  // Unmount React root before clearing
  if (__root) {
    try {
      __root.unmount();
    } catch (e) {
      // Ignore unmount errors
    }
    __root = null;
  }

  const playersEl = document.getElementById("players-wrapper")!;

  playersEl.innerHTML = `
        <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 40px;
            text-align: center;
            color: #888;
        ">
            <div>
                <div style="font-size: 48px; margin-bottom: 16px;">📹</div>
                <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">No Previews</div>
                <div style="font-size: 14px; line-height: 1.5; max-width: 400px;">
                    Add a TypeScript/TSX code block with a <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">preview()</code> call to see Remotion content here.
                </div>
            </div>
        </div>
    `;
}

function renderPlayers(sequence: Sequence): void {
  const deps = (window as any).__REMOTION_DEPS__ || {};
  const React = deps.react;
  const PlayerModule = deps["@remotion/player"];
  const Player =
    (PlayerModule && PlayerModule.Player) ||
    (PlayerModule && PlayerModule.default) ||
    PlayerModule;
  const ReactDomClient = deps["react-dom/client"] || deps["react-dom"];
  const playersEl = document.getElementById("players-wrapper")!;

  if (!React || !ReactDomClient || !Player) {
    throw new Error("Missing React, ReactDOM, or @remotion/player");
  }

  const createRoot =
    ReactDomClient.createRoot || ReactDomClient.unstable_createRoot;
  if (createRoot && !__root) {
    __root = createRoot(playersEl);
  }

  // Default player options (must match PREVIEW_DEFAULTS in preview.ts)
  const DEFAULT_OPTIONS = {
    durationInFrames: 150,
    fps: 30,
    compositionWidth: 1280,
    compositionHeight: 720,
    controls: true,
    loop: false,
    autoPlay: false,
  };

  const scenes = (sequence && sequence.scenes) || [];

  // Render players - positions will be applied by repositionPlayers()
  const nodes = scenes.map((scene: Scene, idx: number) => {
    // Merge scene options with defaults
    const playerOptions = scene.options
      ? { ...DEFAULT_OPTIONS, ...scene.options }
      : DEFAULT_OPTIONS;

    return React.createElement(
      "div",
      {
        key: scene.id,
        "data-scene-id": scene.id,
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

  console.log("[iframe] Rendering", nodes.length, "players");

  if (__root) {
    __root.render(React.createElement(React.Fragment, null, ...nodes));
  } else if (ReactDomClient.render) {
    ReactDomClient.render(
      React.createElement(React.Fragment, null, ...nodes),
      playersEl,
    );
  }

  // After render, ensure players have correct positions
  repositionPlayers();

  console.log("[iframe] Players rendered, notifying parent in 100ms");

  // Notify parent that players have been rendered with their dimensions
  setTimeout(() => {
    console.log("[iframe] Sending player-status message");
    const playersContainer = document.getElementById("players-wrapper");
    const playerElements = playersContainer
      ? Array.from(playersContainer.children)
      : [];

    const playerStatuses = playerElements.map((el, index) => ({
      index,
      height: (el as HTMLElement).offsetHeight || 100,
    }));

    window.parent.postMessage(
      { type: "player-status", players: playerStatuses },
      "*",
    );
  }, 100);
}

/**
 * Apply positions to existing player DOM elements
 * Called after render and on reflow to update positions
 */
function repositionPlayers(): void {
  const playersContainer = document.getElementById("players-wrapper")!;

  const playerElements = Array.from(playersContainer.children) as HTMLElement[];

  playerElements.forEach((element, index) => {
    const position = playerPositions[index];
    if (position) {
      element.style.position = "absolute";
      element.style.top = `${position.topOffset}px`;
      element.style.left = "12px";
      element.style.right = "12px";
    }
  });
}

function renderPreviewBands(previewLocations: PixelBand[]): void {
  const bandsContainer = document.getElementById("bands-wrapper");
  if (!bandsContainer) return;

  // Clear existing bands
  bandsContainer.innerHTML = "";

  // Only show bands if we have preview locations and types passed
  if (!previewLocations || previewLocations.length === 0) return;

  // Create a band for each preview() call
  previewLocations.forEach((loc) => {
    const band = document.createElement("div");
    band.className = "preview-band";

    band.style.top = loc.topOffset + "px";
    band.style.height = loc.height + "px";

    bandsContainer.appendChild(band);
  });
}

function renderError(errorMessage: string, errorStack: string): void {
  // Remove any existing error overlay first
  const existingOverlay = document.getElementById("error-overlay");
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // Create error overlay that sits on top of existing content
  const overlay = document.createElement("div");
  overlay.id = "error-overlay";
  overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
        z-index: 10000;
    `;

  overlay.innerHTML = `
        <div style="
            background: rgba(255, 50, 50, 0.1);
            border: 1px solid rgba(255, 50, 50, 0.3);
            border-radius: 8px;
            padding: 24px;
            max-width: 600px;
            width: 100%;
        ">
            <div style="font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #ff6b6b;">⚠️ Runtime Error</div>
            <div style="font-size: 14px; line-height: 1.5; color: #ffcccc; margin-bottom: 12px;">${errorMessage}</div>
            ${errorStack ? `<details style="margin-top: 12px;"><summary style="cursor: pointer; color: #ffaaaa; font-size: 12px;">Stack Trace</summary><pre style="font-size: 11px; overflow: auto; margin-top: 8px; color: #ffcccc;">${errorStack}</pre></details>` : ""}
        </div>
    `;

  document.body.appendChild(overlay);
}

function clearError(): void {
  const existingOverlay = document.getElementById("error-overlay");
  if (existingOverlay) {
    existingOverlay.remove();
  }
}

function loadBundle(code: string): void {
  try {
    (window as any).RemotionBundle = undefined;
    // eslint-disable-next-line no-eval
    eval(code);
    const mod = (window as any).RemotionBundle;
    let sequence = (mod && mod.default) || mod;

    // If no explicit default export, build scenes from preview() calls
    if (!sequence || !sequence.scenes) {
      const previewComponents = (globalThis as any).__previewComponents || [];
      const previewOptions = (globalThis as any).__previewOptions || [];

      if (previewComponents.length > 0) {
        const scenes = previewComponents.map(
          (component: unknown, i: number) => ({
            id: "__scene_" + i,
            component: component,
            options: previewOptions[i] || {},
          }),
        );
        sequence = { scenes };
      } else {
        // No previews - show empty state (clear content first)
        const playersEl = document.getElementById("players-wrapper");
        if (playersEl) {
          playersEl.innerHTML = "";
        }
        renderEmptyState();
        clearError();
        hideLoadingScreen();
        return;
      }
    }

    // Success - clear any error overlay and render players
    clearError();
    hideLoadingScreen();
    renderPlayers(sequence);
  } catch (err) {
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    const stack = err && (err as any).stack ? (err as any).stack : "";
    // Show error overlay but keep existing players (or loading screen if no content yet)
    if (hasContent) {
      renderError(message, stack);
    } else {
      hideLoadingScreen();
      renderError(message, stack);
    }
    window.parent.postMessage(
      {
        type: "runtime-error",
        error: { message, stack },
      },
      "*",
    );
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as IframeCommand | undefined;
  if (!data) return;

  if (data.type === "reset") {
    resetPanel();
  } else if (data.type === "reflow") {
    handleReflow(data as IframeCommand & { type: "reflow" });
  } else if (data.type === "bundle") {
    handleBundle(data as IframeCommand & { type: "bundle" });
  } else if (data.type === "scroll") {
    handleScroll(data as IframeCommand & { type: "scroll" });
  }
});

window.parent.postMessage({ type: "iframe-ready" }, "*");
