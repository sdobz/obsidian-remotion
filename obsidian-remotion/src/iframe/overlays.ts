/**
 * UI overlays module
 * Handles loading screens, error overlays, and empty state rendering
 */

export class OverlayManager {
  private hasContent = false;
  private errorOverlay: HTMLElement | null = null;

  constructor(
    private DOM: {
      loadingScreen: HTMLElement;
      playersContainer: HTMLElement;
    },
  ) {}

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
                <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">No Previews</div>
                <div style="font-size: 14px; line-height: 1.5; max-width: 400px;">
                    Add a TypeScript/TSX code block with a <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">preview()</code> call to see Remotion content here.
                </div>
            </div>
        </div>
    `;
  }

  showError(errorMessage: string, errorStack: string): void {
    this.clearError();

    const overlay = document.createElement("div");
    overlay.id = "error-overlay";
    this.errorOverlay = overlay;
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

  clearError(): void {
    if (this.errorOverlay) {
      this.errorOverlay.remove();
      this.errorOverlay = null;
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
