// Keykeeper: the check every flat tile passes (DESIGN.md, "The look"): its
// glyph, in the tone, keeps 3:1 or more on its tint laid over each surface a
// tile sits on, in both themes. The surfaces are brand/look.css's.
import { KEYKEEPER_TILE_TINT, KeykeeperCategoryLook } from "./categories";

type Rgb = readonly number[];

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** [top] at [alpha] laid over [under]. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb =>
  top.map((c, i) => c * alpha + under[i] * (1 - alpha));

const white: Rgb = [255, 255, 255];

function luminance(color: Rgb) {
  const [r, g, b] = color.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const darkGround = rgb("#111318");
// The dark ground where its sapphire wash is brightest (--pb-wash).
const darkWash = over(rgb("#2448B8"), 0.24, darkGround);
const darkCard = over(white, 0.055, darkGround);
const darkRaised = over(white, 0.085, darkGround);
const darkPicked = over(rgb("#6FD4B4"), 0.12, darkCard);

/** What tiles sit on, light and dark (brand/look.css's --pb-* tokens). */
export const TILE_SURFACES: Readonly<Record<"light" | "dark", Readonly<Record<string, Rgb>>>> = {
  light: {
    "a card, a menu, a dialog, or the fill menu": white,
    "the ground": rgb("#EEF2F0"),
    "the menu's picked entry": rgb("#E7F1ED"),
    "a chip": rgb("#E6ECE9"),
    "the sunken gray": rgb("#E1E8E5"),
  },
  dark: {
    "the ground": darkGround,
    "the ground's brightest wash": darkWash,
    "a card": darkCard,
    "a raised card": darkRaised,
    "the menu's picked entry": darkPicked,
    "a raised card on the brightest wash": over(white, 0.085, darkWash),
    "a picked entry on the brightest wash": over(
      rgb("#6FD4B4"),
      0.12,
      over(white, 0.085, darkWash),
    ),
    "a menu, and the fill menu": rgb("#1C1F25"),
    "the lightest solid surface": rgb("#2A2E36"),
  },
};

/**
 * Every tile whose glyph falls under 3:1 on its tint over a surface, as
 * "name (theme) on surface: ratio"; none when they all pass.
 */
export function flatTileFailures(looks: Readonly<Record<string, KeykeeperCategoryLook>>) {
  const failures: string[] = [];
  for (const [name, look] of Object.entries(looks)) {
    for (const theme of ["light", "dark"] as const) {
      const tone = rgb(look[theme]);
      for (const [on, surface] of Object.entries(TILE_SURFACES[theme])) {
        const ratio = contrast(tone, over(tone, KEYKEEPER_TILE_TINT[theme], surface));
        if (ratio < 3) {
          failures.push(`${name} (${theme}) on ${on}: ${ratio.toFixed(2)}`);
        }
      }
    }
  }
  return failures;
}
