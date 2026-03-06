/**
 * Iframe runtime entry point.
 *
 * This module is included as a side-effect preamble in every synthesized user
 * bundle via `import "obsidian-remotion-runtime/iframe"` injected by synthesis.ts.
 * When esbuild bundles user code it pulls this module in automatically, so the
 * resulting IIFE contains the full runtime + user code in one payload.
 *
 * On eval the module:
 *   - Grabs DOM references from the iframe.html structure
 *   - Instantiates BundleManager, PlayerManager, ScrollCoordinator, etc.
 *   - Registers window.__handleCommand (called by iframe.html bootstrap)
 *   - Registers window.__dumpRuntimeState (used by tests)
 *
 * It does NOT send runtime-ready – the bootstrap does that before the first
 * bundle arrives so the host knows the iframe is alive.
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
const linkOverlay = document.getElementById("link-overlay") as unknown as SVGSVGElement;

// ---------------------------------------------------------------------------
// Cleanup previous module eval (successive bundle evals)
// ---------------------------------------------------------------------------
// On each bundle eval, the entire module runs again. If a previous eval left
// a cleanup function registered, call it now before creating new instances.
// This unmounts the old React root synchronously before we create a new one.
const anyWin = window as any;
if (typeof anyWin.__runtimeCleanup === "function") {
  try { anyWin.__runtimeCleanup(); } catch (_) { /* ignore */ }
}

// Reset render() accumulator so successive bundle evals start fresh.
// Without this, render() calls from prior evals remain in __previewComponents
// and the new bundle's components are appended rather than replacing them.
anyWin.__previewComponents = [];
anyWin.__previewOptions = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendMessage(msg: unknown): void {
  window.parent.postMessage(msg, "*");
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
// Bundle activation
//
// Called by __handleCommand when a `bundle` command arrives. At this point
// the IIFE (runtime + user code) has ALREADY been eval'd by the bootstrap
// – window.__previewComponents is already populated by render() calls.
// We do NOT re-eval the payload; we just read the registered components and
// mount them.
// ---------------------------------------------------------------------------
function handleBundle(): void {
  overlay.clearError();
  bundleManager.reset();

  // Read components registered by render() calls during the initial IIFE eval
  const anyWindow = window as any;
  const previewComponents: unknown[] = anyWindow.__previewComponents ?? [];
  const previewOptions: Record<string, unknown>[] = anyWindow.__previewOptions ?? [];

  const components: ComponentInfo[] = previewComponents.map((component, index) => ({
    exportName: `__scene_${index}`,
    component,
  }));

  // Also build a sequence so reflow has access to it
  bundleManager.setSequence(
    components.map((c, i) => ({
      id: c.exportName,
      component: c.component,
      options: previewOptions[i] ?? {},
    })),
  );

  if (components.length === 0) {
    playerManager.reset();
    // Don't render empty state into widgetsContainer – leave it blank.
    // Tests and the host can check children.length === 0 to detect no content.
  } else {
    playerManager.renderAll(components);
    bandsLinks.renderBands(playerManager.playerPositions);
    playerManager.scheduleUpdate();
  }

  overlay.hideLoading();
}

// ---------------------------------------------------------------------------
// Command dispatch – registered on window so iframe.html bootstrap can call it
// ---------------------------------------------------------------------------
function handleCommand(cmd: IframeCommand): void {
  switch (cmd.type) {
    case "bundle":
      handleBundle();
      break;

    case "reflow": {
      const { bandScrollHeight, bands, widgetScrollHeight, widgets, interpolatorSpecs } = cmd;
      scrollCoordinator.updateInterpolators(interpolatorSpecs);
      playerManager.handleReflow(widgets, bundleManager.sequence);
      bandsLinks.renderBands(bands);
      const { bandScrollTop, playerScrollTop } = scrollCoordinator.scrollPositions;
      bandsLinks.renderLinks(widgets, bandScrollTop, playerScrollTop);
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

// Register a cleanup function so the NEXT bundle eval can tear down this one.
// Called at the top of each successive iframe/main.ts module eval.
(window as any).__runtimeCleanup = () => {
  try { playerManager.reset(); } catch (_) { /* ignore */ }
  scrollCoordinator.reset();
  bandsLinks.reset();
};

// Debug dump for test inspection
(window as any).__dumpRuntimeState = () => ({
  previewComponents: (window as any).__previewComponents?.length ?? 0,
  widgetDomCount: widgetsContainer.querySelectorAll("[data-component-name]").length,
  loadingHidden: loadingScreen.classList.contains("hidden"),
  errorVisible: !!(document.getElementById("error-overlay") as any)?.classList.contains("visible"),
});

