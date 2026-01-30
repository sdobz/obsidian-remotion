/**
 * Iframe runtime script for Remotion preview
 * This runs inside the sandboxed iframe and manages player rendering, scroll sync, and error handling
 */

import type { PreviewMessage, IframeCommand } from "./preview";
import { StatusInfo } from "./ui";

type PreviewLocation = {
  topOffset?: number;
  height?: number;
  endOffset?: number;
  options?: Record<string, unknown>;
  line?: number;
};

type Scene = {
  id: string;
  component: unknown;
  options?: Record<string, unknown>;
};

type Sequence = {
  scenes: Scene[];
};

// State management
let typecheckState: StatusInfo = { status: "loading", errorCount: 0 };
let bundleState: StatusInfo = {
  status: "loading",
  error: null,
};
let hasContent = false;
let currentPreviewLocations: PreviewLocation[] = [];

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

(window as any).__REMOTION_DEPS__ = (window as any).__REMOTION_DEPS__ || {};
let __root: any = null;

function notifyStatusUpdate() {
  // Send status to parent for Obsidian status bar
  window.parent.postMessage(
    {
      type: "status-update",
      typecheck: typecheckState,
      bundle: bundleState,
    },
    "*",
  );
}

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
  const playersEl = document.getElementById("players");
  if (playersEl) {
    playersEl.innerHTML = "";
  }
  const bandsEl = document.getElementById("preview-bands");
  if (bandsEl) {
    bandsEl.innerHTML = "";
  }
  clearError();

  // Reset status
  typecheckState = { status: "loading", errorCount: 0 };
  bundleState = { status: "loading", error: null };
  hasContent = false;

  // Show loading screen
  showLoadingScreen();
}

function handleTypecheckStatus(
  cmd: IframeCommand & { type: "typecheck-status" },
) {
  typecheckState.status = cmd.status;
  typecheckState.errorCount = cmd.errorCount || 0;
  notifyStatusUpdate();
  // Update bands when typecheck status changes
  renderPreviewBands(currentPreviewLocations);
}

function handleBundleStatus(cmd: IframeCommand & { type: "bundle-status" }) {
  bundleState.status = cmd.status;
  bundleState.error = cmd.error || null;
  notifyStatusUpdate();
}

function handleBundleOutput(cmd: IframeCommand & { type: "bundle-output" }) {
  if (cmd.payload) {
    loadBundle(cmd.payload, cmd.previewLocations || []);
  }
}

function handleViewportSync(cmd: IframeCommand & { type: "viewport-sync" }) {
  if (typeof cmd.scrollTop === "number") {
    console.log("[iframe] Setting scrollTop to", cmd.scrollTop);
    window.scrollTo({ top: cmd.scrollTop, behavior: "instant" });
  }
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

  const playersEl = document.getElementById("players");
  if (!playersEl) return;

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

function renderPlayers(
  sequence: Sequence,
  previewLocations: PreviewLocation[],
): void {
  const deps = (window as any).__REMOTION_DEPS__ || {};
  const React = deps.react;
  const PlayerModule = deps["@remotion/player"];
  const Player =
    (PlayerModule && PlayerModule.Player) ||
    (PlayerModule && PlayerModule.default) ||
    PlayerModule;
  const ReactDomClient = deps["react-dom/client"] || deps["react-dom"];
  const playersEl = document.getElementById("players");

  if (!React || !ReactDomClient || !Player || !playersEl) {
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

  // Use preview locations as position anchors
  // Each preview() call in the source maps to a component to display

  const nodes = scenes.map((scene: Scene, idx: number) => {
    const loc = previewLocations && previewLocations[idx];
    // Merge preview location options with defaults
    const playerOptions =
      loc && loc.options
        ? { ...DEFAULT_OPTIONS, ...loc.options }
        : DEFAULT_OPTIONS;

    return React.createElement(
      "div",
      {
        key: scene.id,
        "data-scene-id": scene.id,
        "data-preview-line": (loc && loc.line) || 0,
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

  updateScrollableHeight(previewLocations);

  console.log("[iframe] Players rendered, notifying parent in 100ms");

  // Notify parent that players have been rendered for scroll sync
  setTimeout(() => {
    console.log("[iframe] Sending players-rendered message");
    window.parent.postMessage({ type: "players-rendered" }, "*");
  }, 100);

  // Render preview bands if type checking passed
  renderPreviewBands(previewLocations);
}

function updateScrollableHeight(previewLocations: PreviewLocation[]): void {
  const playersEl = document.getElementById("players");
  if (!playersEl) return;

  let maxEnd = 0;
  if (Array.isArray(previewLocations)) {
    previewLocations.forEach((loc) => {
      if (typeof loc.topOffset !== "number") return;
      const height =
        typeof loc.height === "number" && loc.height > 0 ? loc.height : 24;
      const endOffset =
        typeof loc.endOffset === "number"
          ? loc.endOffset
          : loc.topOffset + height;
      if (endOffset > maxEnd) maxEnd = endOffset;
    });
  }

  const padding = 48;
  const minHeight = window.innerHeight || 0;
  const targetHeight = Math.max(maxEnd + padding, minHeight);
  playersEl.style.height = targetHeight + "px";
  document.body.style.height = targetHeight + "px";
  document.documentElement.style.height = targetHeight + "px";
}

function renderPreviewBands(previewLocations: PreviewLocation[]): void {
  const bandsContainer = document.getElementById("preview-bands");
  if (!bandsContainer) return;

  // Clear existing bands
  bandsContainer.innerHTML = "";

  // Only show bands if we have preview locations and types passed
  if (!previewLocations || previewLocations.length === 0) return;
  if (typecheckState.status !== "ok") return;

  // Create a band for each preview() call
  previewLocations.forEach((loc) => {
    if (typeof loc.topOffset !== "number") return;

    const band = document.createElement("div");
    band.className = "preview-band";

    // Calculate band height properly
    const height =
      typeof loc.height === "number" && loc.height > 0 ? loc.height : 24;
    const endOffset = loc.endOffset || loc.topOffset + height;
    const bandHeight = endOffset - loc.topOffset;

    band.style.top = loc.topOffset + "px";
    band.style.height = bandHeight + "px";

    bandsContainer.appendChild(band);
  });

  updateScrollableHeight(previewLocations);
}

function renderError(errorMessage: string, errorStack: string): void {
  // Show error overlay without clearing existing players
  const playersEl = document.getElementById("players");
  if (!playersEl) return;

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

function loadBundle(code: string, previewLocations: PreviewLocation[]): void {
  // Store preview locations for band rendering
  currentPreviewLocations = previewLocations || [];

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
        const playersEl = document.getElementById("players");
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
    renderPlayers(sequence, previewLocations);
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
  } else if (data.type === "typecheck-status") {
    handleTypecheckStatus(data as IframeCommand & { type: "typecheck-status" });
  } else if (data.type === "bundle-status") {
    handleBundleStatus(data as IframeCommand & { type: "bundle-status" });
  } else if (data.type === "bundle-output") {
    handleBundleOutput(data as IframeCommand & { type: "bundle-output" });
  } else if (data.type === "viewport-sync") {
    handleViewportSync(data as IframeCommand & { type: "viewport-sync" });
  }
});

window.parent.postMessage({ type: "iframe-ready" }, "*");
