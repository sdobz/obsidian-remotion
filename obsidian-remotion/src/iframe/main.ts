/**
 * Iframe preview main entry point - Wiring Layer
 *
 * This module serves as the coordination layer that:
 * 1. Initializes all feature modules with their DOM dependencies
 * 2. Wires state and callbacks between modules
 * 3. Routes messages to appropriate handlers
 * 4. Makes primary data flows immediately visible
 *
 * Data flows:
 * - Editor → scroll → bands-links (scroll commands)
 * - Editor → bundle → players → bands-links (bundle/reflow commands)
 * - Players → scroll → editor (player scroll events, height updates)
 * - Bundle errors → overlays → editor (error messages)
 */

import type { IframeCommand } from "../preview";
import { BundleManager } from "./bundle";
import { PlayerManager } from "./players";
import { BandsLinksRenderer } from "./bands-links";
import { ScrollCoordinator } from "./scroll";
import { OverlayManager } from "./overlays";

// Shared DOM cache - all elements are known to exist in the iframe structure
const DOM = {
  loadingScreen: document.getElementById("loading-screen")!,
  playersContainer: document.getElementById("players-container")!,
  bandsContainer: document.getElementById("bands-container")!,
  bandScroller: document.getElementById("bands-scroller")!,
  playerScroller: document.getElementById("players-scroller")!,
  linkOverlay: document.getElementById(
    "link-overlay",
  ) as unknown as SVGSVGElement,
};

function sendMessage(msg: any): void {
  window.parent.postMessage(msg, "*");
}

// Initialize all feature modules
const bundle = new BundleManager();
const overlays = new OverlayManager(DOM);
const players = new PlayerManager(DOM, sendMessage);
const bandsLinks = new BandsLinksRenderer(DOM);
const scroll = new ScrollCoordinator(
  DOM,
  (playerScrollTop: number) => {
    sendMessage({ type: "player-scroll", playerScrollTop });
  },
  () => {
    const { bandScrollTop, playerScrollTop } = scroll.scrollPositions;
    bandsLinks.renderLinks(
      players.playerPositions,
      bandScrollTop,
      playerScrollTop,
    );
  },
);

function handleReflow(cmd: IframeCommand & { type: "reflow" }): void {
  scroll.updateInterpolators(cmd.interpolatorSpecs);

  DOM.bandsContainer.style.height = cmd.bandScrollHeight + "px";
  DOM.playersContainer.style.height = cmd.playerScrollHeight + "px";

  bandsLinks.renderBands(cmd.bands);

  if (!bundle.sequence) {
    const { bandScrollTop, playerScrollTop } = scroll.scrollPositions;
    bandsLinks.renderLinks(
      players.playerPositions,
      bandScrollTop,
      playerScrollTop,
    );
    return;
  }

  players.handleReflow(cmd.players, bundle.sequence);

  const { bandScrollTop, playerScrollTop } = scroll.scrollPositions;
  bandsLinks.renderLinks(
    players.playerPositions,
    bandScrollTop,
    playerScrollTop,
  );
  players.scheduleUpdate();
}

function handleBundle(cmd: IframeCommand & { type: "bundle" }): void {
  if (!cmd.payload) return;

  const sequence = bundle.loadBundle(cmd.payload, (message, stack) => {
    const hasContent = players.contentStatus || overlays.contentStatus;
    if (hasContent) {
      overlays.showError(message, stack);
    } else {
      overlays.hideLoading();
      overlays.showError(message, stack);
    }
    sendMessage({ type: "runtime-error", error: { message, stack } });
  });

  if (sequence === null) {
    DOM.playersContainer.innerHTML = "";
    overlays.renderEmptyState();
    overlays.clearError();
    overlays.hideLoading();
    return;
  }

  overlays.clearError();
  overlays.hideLoading();

  if (bandsLinks.bands.length > 0) {
    players.renderAll(sequence);
    players.scheduleUpdate();
  }
}

function handleScroll(cmd: IframeCommand & { type: "scroll" }): void {
  scroll.scrollTo(cmd.editorScrollTop);
}

function resetPanel(): void {
  players.reset();
  bandsLinks.reset();
  scroll.reset();
  bundle.reset();
  overlays.reset();
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

sendMessage({ type: "iframe-ready" });
