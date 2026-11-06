// Keykeeper: every Health report's tile (keykeeper/health/report-tiles.ts).
import { flatTileFailures } from "@bitwarden/common/vault/keykeeper/flat-tile-contrast.spec-util";

import { KEYKEEPER_REPORT_TILES } from "../../keykeeper/health/report-tiles";

import { reports } from "./reports";

describe("KEYKEEPER_REPORT_TILES", () => {
  it("gives every Health report a tile, by its route", () => {
    for (const report of Object.values(reports)) {
      expect(KEYKEEPER_REPORT_TILES[report.route]).toBeDefined();
    }
  });

  it("keeps every report's glyph readable on its tint, light and dark (3:1 or more)", () => {
    expect(flatTileFailures(KEYKEEPER_REPORT_TILES)).toEqual([]);
    for (const tile of Object.values(KEYKEEPER_REPORT_TILES)) {
      expect(tile.glyph).toMatch(/^M/);
    }
  });
});
