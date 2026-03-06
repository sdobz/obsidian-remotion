/**
 * UI overlays module
 * Handles loading screens, error overlays, and empty state rendering.
 *
 * Uses the pre-existing DOM elements from iframe.html:
 *   #loading-screen  – full-viewport loading placeholder
 *   #error-overlay   – hidden by default; shown by adding .visible
 *   #error-message   – text content of the error
 */

export class OverlayManager {
  private hasContent = false;
  private errorOverlay: HTMLElement | null;
  private errorMessageEl: HTMLElement | null;

  constructor(
    private DOM: {
      loadingScreen: HTMLElement;
      playersContainer: HTMLElement;
    },
  ) {
    this.errorOverlay = document.getElementById("error-overlay");
    this.errorMessageEl = document.getElementById("error-message");
  }

  showLoading(): void {
    this.DOM.loadingScreen.classList.remove("hidden");
    this.hasContent = false;
  }

  hideLoading(): void {
    this.DOM.loadingScreen.classList.add("hidden");
    this.hasContent = true;
  }

  renderEmptyState(): void {
    this.DOM.playersContainer.innerHTML = `
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
                <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">No Rendered Components</div>
                <div style="font-size: 14px; line-height: 1.5; max-width: 400px;">
                  Add a TypeScript/TSX code block with a <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">render()</code> call to see content here.
                </div>
            </div>
        </div>
    `;
  }

  showError(errorMessage: string, errorStack: string): void {
    if (this.errorOverlay && this.errorMessageEl) {
      // Use the pre-existing iframe.html elements
      const text = errorMessage + (errorStack ? "\n\n" + errorStack : "");
      this.errorMessageEl.textContent = text;
      this.errorOverlay.classList.add("visible");
    } else {
      // Fallback: create a dynamic overlay (should not happen in normal usage)
      this.clearError();
      const overlay = document.createElement("div");
      overlay.id = "error-overlay";
      overlay.classList.add("visible");
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; padding: 40px; z-index: 10000;
      `;
      overlay.innerHTML = `
        <div style="background:rgba(255,50,50,.1);border:1px solid rgba(255,50,50,.3);
          border-radius:8px;padding:24px;max-width:600px;width:100%;">
          <div id="error-message" style="font-size:14px;color:#ffcccc;">${errorMessage}</div>
        </div>`;
      document.body.appendChild(overlay);
      // Update cached refs
      this.errorOverlay = overlay;
      this.errorMessageEl = overlay.querySelector("#error-message");
    }
  }

  clearError(): void {
    if (this.errorOverlay) {
      this.errorOverlay.classList.remove("visible");
      if (this.errorMessageEl) {
        this.errorMessageEl.textContent = "";
      }
    }
  }

  get contentStatus(): boolean {
    return this.hasContent;
  }

  reset(): void {
    this.clearError();
    this.hasContent = false;
    this.showLoading();
  }
}

