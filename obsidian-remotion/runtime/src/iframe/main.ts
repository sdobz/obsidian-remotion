/**
 * Iframe runtime entry point.
 *
 * This module is compiled into the "runtime bundle" that iframe.html loads.
 * It owns:
 *   - Receiving the `bundle` command → eval user code → render widgets
 *   - Receiving `reflow`, `scroll`, `reset`, `show-error`, `clear-error` commands
 *   - Sending `runtime-ready`, `widget-status`, `widget-scroll`, `runtime-error` messages
 *   - Mounting a React root in #widgets-container
 *   - Coordinating scroll sync via ScrollCoordinator
 *   - Drawing band-link overlays via BandsLinksRenderer
 *
 * Architecture: single bundle (runtime + user code).
 * The bootstrap in iframe.html executes this bundle via `new Function(payload)(window)`,
 * which registers `window.__handleCommand` for subsequent commands and immediately
 * posts `runtime-ready`.
 */

import type { IframeCommand } from "../shared/types";
import { BundleManager } from "./bundle";
import { PlayerManager, type ComponentInfo } from "./players";
import { OverlayManager } from "./overlays";
import { ScrollCoordinator } from "./scroll";
import { BandsLinksRenderer } from "./bands-links";

// ---------------------------------------------------------------------------
// DOM references – elements defined in iframe.html
// ---------------------------------------------------------------------------
const loadingScreen = document.getElementById("loading-screen") as HTMLElement;
const widgetsContainer = document.getElementById("widgets-container") as HTMLElement;
const widgetsScroller = document.getElementById("widgets-scroller") as HTMLElement;
const bandsContainer = document.getElementById("bands-container") as HTMLElement;
const linkOverlay = document.getElementById("link-overlay") as SVGSVGElement;
const debugContent = document.getElementById("debug-content") as HTMLElement;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendMessage(msg: unknown): void {
  window.parent.postMessage(msg, "*");
}

function updateDebug(info: Record<string, unknown>): void {
  if (!debugContent) return;
  debugContent.innerHTML = Object.entries(info)
    .map(
      ([k, v]) =>
        `<div class="debug-item"><strong>${k}:</strong> <span class="debug-value">${String(v)}</span></div>`,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Module instances
// ---------------------------------------------------------------------------
const overlay = new OverlayManager({ loadingScreen, playersContainer: widgetsContainer });

const playerManager = new PlayerManager(
  { playersContainer: widgetsContainer },
  sendMessage,
);

const bandsLinks = new BandsLinksRenderer({
  bandsContainer,
  linkOverlay,
});

const scrollCoordinator = new ScrollCoordinator(
  { bandScroller: bandsContainer, playerScroller: widgetsScroller },
  (widgetScrollTop: number) => sendMessage({ type: "widget-scroll", widgetScrollTop }),
  () => {
    const { bandScrollTop, playerScrollTop } = scrollCoordinator.scrollPositions;
    bandsLinks.renderLinks(playerManager.playerPositions, bandScrollTop, playerScrollTop);
  },
);

const bundleManager = new BundleManager();

// ---------------------------------------------------------------------------
// Bundle execution
// ---------------------------------------------------------------------------
function handleBundle(payload: string): void {
  overlay.clearError();
  bundleManager.reset();

  const sequence = bundleManager.loadBundle(payload, (message, stack) => {
    overlay.showError(message, stack);
    sendMessage({ type: "runtime-error", error: { message, stack } });
  });

  const components: ComponentInfo[] = (sequence?.scenes ?? []).map((scene) => ({
    exportName: scene.id,
    component: scene.component,
  }));

  if (components.length === 0) {
    playerManager.reset();
    overlay.renderEmptyState();
    updateDebug({ status: "bundle loaded", components: 0 });
  } else {
    playerManager.renderAll(components);
    bandsLinks.renderBands(playerManager.playerPositions);
    playerManager.scheduleUpdate();
    updateDebug({
      status: "bundle loaded",
      components: components.length,
      names: components.map((c) => c.exportName).join(", "),
    });
  }

  overlay.hideLoading();
}

// ---------------------------------------------------------------------------
// Command dispatch – registered on window so iframe.html bootstrap can call it
// ---------------------------------------------------------------------------
function handleCommand(cmd: IframeCommand): void {
  switch (cmd.type) {
    case "bundle":
      handleBundle(cmd.payload);
      break;

    case "reflow": {
      const { bandScrollHeight, bands, widgetScrollHeight, widgets, interpolatorSpecs } = cmd;
      scrollCoordinator.updateInterpolators(interpolatorSpecs);
      playerManager.handleReflow(widgets, bundleManager.sequence);
      bandsLinks.renderBands(bands);
      const { bandScrollTop, playerScrollTop } = scrollCoordinator.scrollPositions;
      bandsLinks.renderLinks(widgets, bandScrollTop, playerScrollTop);
      updateDebug({
        status: "reflowed",
        bands: bands.filter(Boolean).length,
        widgets: widgets.filter(Boolean).length,
        bandScrollHeight,
        widgetScrollHeight,
      });
      break;
    }

    case "scroll":
      scrollCoordinator.scrollTo(cmd.editorScrollTop);
      break;

    case "reset":
      bundleManager.reset();
      playerManager.reset();
      bandsLinks.reset();
      scrollCoordinator.reset();
      overlay.reset();
      updateDebug({ status: "reset" });
      break;

    case "show-error":
      overlay.showError(cmd.message, cmd.stack ?? "");
      break;

    case "clear-error":
      overlay.clearError();
      break;
  }
}

// Expose to bootstrap script in iframe.html
(window as any).__handleCommand = handleCommand;

// Debug dump for test inspection
(window as any).__dumpRuntimeState = () => ({
  previewComponents: (window as any).__previewComponents?.length ?? 0,
  widgetDomCount: widgetsContainer.children.length,
  loadingHidden: loadingScreen.classList.contains("hidden"),
  errorVisible: !!(document.getElementById("error-overlay") as any)?.classList.contains("visible"),
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
updateDebug({ status: "ready", waitingFor: "bundle" });
sendMessage({ type: "runtime-ready" });
