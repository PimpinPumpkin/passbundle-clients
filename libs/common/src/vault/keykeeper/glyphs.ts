// Keykeeper: the glyphs our flat tiles draw (DESIGN.md, "The look"), by what
// they show: SVG path data on a 24 by 24 grid, stroked in the tile's tone.
// The categories (categories.ts) and shared folders' icons (folder-looks.ts)
// draw from these, and the apps (passbundle-apps, app/lib/glyphs.dart) and
// passbundle.com (site/icons.mjs in the keykeeper repo) have the same.

export const KEYKEEPER_GLYPHS = {
  grid: "M4 4h7v7H4Z M13 4h7v7h-7Z M4 13h7v7H4Z M13 13h7v7h-7Z",
  key: "M8 14a4 4 0 1 1 3.87-5H21v3h-2v3h-3v-3h-4.13A4 4 0 0 1 8 14Z M7 10h.01",
  note: "M6 3h9l4 4v14H6Z M14 3v5h5 M9 12h7 M9 16h5",
  card: "M3 6h18v12H3Z M3 10h18 M7 15h4",
  identity:
    "M4 5h16v14H4Z M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M5.5 16c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8 M14 9h4 M14 13h4",
  terminal: "M3 5h18v14H3Z M7 10l3 2-3 2 M12 15h5",
  bank: "M3 9l9-5 9 5 M5 10v7 M9.5 10v7 M14.5 10v7 M19 10v7 M3 20h18",
  wifi: "M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01",
  server: "M4 4h16v6H4Z M4 14h16v6H4Z M8 7h.01 M8 17h.01",
  license: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z M9 8h6 M9 12h6",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z",
  envelope: "M3 6h18v12H3Z M3 7l9 6 9-6",
  badge: "M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M8.6 12.6 7 21l5-2.6 5 2.6-1.6-8.4",
  star: "M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9 5.5-.8Z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6Z M8.5 12l2.5 2.5 4.5-5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3.5 2",
} as const;
