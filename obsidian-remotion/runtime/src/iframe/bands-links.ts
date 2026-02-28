/**
 * Visual connections module
 * Renders preview bands and SVG links connecting bands to players
 */

import type { NullArray, Band } from "../shared/scroll-math";

export class BandsLinksRenderer {
  private currentBands: NullArray<Band> = [];

  constructor(
    private DOM: {
      bandsContainer: HTMLElement;
      linkOverlay: SVGSVGElement;
    },
  ) { }

  renderBands(previewLocations: NullArray<Band>): void {
    this.DOM.bandsContainer.innerHTML = "";
    this.currentBands = previewLocations;

    if (!previewLocations || previewLocations.length === 0) return;

    previewLocations.forEach((loc) => {
      if (!loc) return;

      const band = document.createElement("div");
      band.className = "preview-band";
      const top = loc.center - loc.height / 2;
      band.style.top = top + "px";
      band.style.height = loc.height + "px";

      this.DOM.bandsContainer.appendChild(band);
    });
  }

  renderLinks(
    playerPositions: NullArray<Band>,
    bandScrollTop: number,
    playerScrollTop: number,
  ): void {
    this.DOM.linkOverlay.innerHTML = "";

    if (this.currentBands.length === 0 || playerPositions.length === 0) return;

    const bandLeft = 0;
    const playerLeft = 12;

    for (let i = 0; i < this.currentBands.length; i++) {
      const band = this.currentBands[i];
      const player = playerPositions[i];

      if (!band || !player) continue;

      const bandTop = band.center - band.height / 2 - bandScrollTop;
      const bandBottom = bandTop + band.height;
      const playerTop = player.center - player.height / 2 - playerScrollTop;
      const playerBottom = playerTop + player.height;

      const polygon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon",
      );
      const points = `${bandLeft},${bandTop} ${playerLeft},${playerTop} ${playerLeft},${playerBottom} ${bandLeft},${bandBottom}`;
      polygon.setAttribute("points", points);
      polygon.setAttribute("fill", "rgba(59, 130, 246, 0.2)");
      polygon.setAttribute("stroke", "rgba(59, 130, 246, 0.35)");
      polygon.setAttribute("stroke-width", "1");

      this.DOM.linkOverlay.appendChild(polygon);
    }
  }

  reset(): void {
    this.DOM.bandsContainer.innerHTML = "";
    this.DOM.linkOverlay.innerHTML = "";
    this.currentBands = [];
  }
}
