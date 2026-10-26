import { KeykeeperCategoryLook } from "@bitwarden/common/vault/keykeeper/categories";

/**
 * Keykeeper: each Health report's jewel tile on its card, by the report's
 * route, the same tile as the menu's and the list's (DESIGN.md, "The look"):
 * a jewel tone (light, and a step lighter in dark mode) with a white glyph,
 * in place of upstream's illustration on a block of the brand's color. The
 * organization's reports have the same routes.
 */
export const KEYKEEPER_REPORT_TILES: Readonly<Record<string, KeykeeperCategoryLook>> = {
  // Garnet: a password in a breach.
  "exposed-passwords-report": {
    light: "#A8291F",
    dark: "#B83328",
    glyph: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6Z M12 8v5 M12 16.5h.01",
  },
  // Topaz: the same password, again.
  "reused-passwords-report": {
    light: "#A9600C",
    dark: "#B4690F",
    glyph: "M4 12a8 8 0 0 1 13.7-5.6L20 9 M20 4v5h-5 M20 12a8 8 0 0 1-13.7 5.6L4 15 M4 20v-5h5",
  },
  // Ruby: a gauge reading low.
  "weak-passwords-report": {
    light: "#B01E54",
    dark: "#C0275F",
    glyph: "M4 18a8 8 0 1 1 16 0 M12 18 8 13",
  },
  // Aquamarine: a website.
  "unsecured-websites-report": {
    light: "#1C7FB8",
    dark: "#1F86C2",
    glyph:
      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z",
  },
  // Turquoise: a phone, for the two-step code.
  "inactive-two-factor-report": {
    light: "#08788A",
    dark: "#0A8599",
    glyph: "M8 3h8v18H8Z M11 17.5h2",
  },
  // Amethyst: an email address in a breach.
  "breach-report": {
    light: "#6B30B8",
    dark: "#7A42CC",
    glyph: "M3 6h18v12H3Z M3 7l9 6 9-6",
  },
  // Sapphire: a person and a key, for passkeys.
  "passkey-report": {
    light: "#2448B8",
    dark: "#2E55C9",
    glyph:
      "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M3 20c.8-3.4 3-5 6-5 1.5 0 2.8.4 3.8 1.2 M17 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z M17 18v3 M17 20h2",
  },
  // Emerald: people, and what they can reach.
  "member-access-report": {
    light: "#0E7A47",
    dark: "#128752",
    glyph:
      "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M3 20c.8-3.4 3-5 6-5s5.2 1.6 6 5 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 15c1.6.7 2.6 2.4 3 5",
  },
  // Onyx: a clock, for what expires.
  "expiring-items-report": {
    light: "#353B4A",
    dark: "#4A5266",
    glyph: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2",
  },
};
