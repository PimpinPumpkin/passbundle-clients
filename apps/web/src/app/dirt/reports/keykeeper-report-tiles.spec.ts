// Keykeeper: every Health report's jewel tile (keykeeper/health/report-tiles.ts).
import { KEYKEEPER_REPORT_TILES } from "../../keykeeper/health/report-tiles";

import { reports } from "./reports";

function lum(hex: string) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastWithWhite = (hex: string) => 1.05 / (lum(hex) + 0.05);

describe("KEYKEEPER_REPORT_TILES", () => {
  it("gives every Health report a jewel tile, by its route", () => {
    for (const report of Object.values(reports)) {
      expect(KEYKEEPER_REPORT_TILES[report.route]).toBeDefined();
    }
  });

  it("keeps a white glyph readable on every report's tile, light and dark (3:1 or more)", () => {
    for (const tile of Object.values(KEYKEEPER_REPORT_TILES)) {
      expect(contrastWithWhite(tile.light)).toBeGreaterThanOrEqual(3);
      expect(contrastWithWhite(tile.dark)).toBeGreaterThanOrEqual(3);
      expect(tile.glyph).toMatch(/^M/);
    }
  });
});
