// PassBundle's artwork: every illustration and tab icon that upstream draws
// in Bitwarden's style, redrawn from the logo's shapes (rounded bands and the
// padlock's shackle). Writes one SVG per upstream symbol into this folder;
// brand/apply.mjs puts each one in place of upstream's. Run it after changing
// a drawing: node brand/artwork/draw.mjs
//
// Colors come from the theme's classes, so the art follows light, dark, and
// glass: brand green, its soft tint, the illustration fills (pale, mint,
// white), the outline ink, and the amber accent. Only classes upstream's own
// art already uses, so the build has them. Each drawing says data-art="passbundle",
// so tests can tell it from upstream's.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const C = {
  deep: "tw-fill-fg-brand",
  soft: "tw-fill-fg-brand-soft",
  mint: "tw-fill-illustration-bg-secondary",
  pale: "tw-fill-illustration-bg-primary",
  white: "tw-fill-illustration-bg-tertiary",
  ink: "tw-fill-illustration-outline",
  amber: "tw-fill-illustration-tertiary",
};
const n = (v) => +v.toFixed(2);

// Shapes.
const rect = (x, y, w, h, r, cls, extra = "") =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" class="${cls}"${extra}/>`;
const circle = (cx, cy, r, cls, extra = "") =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" class="${cls}"${extra}/>`;
const path_ = (d, cls, extra = "") => `<path d="${d}" class="${cls}"${extra}/>`;
const op = (o) => ` opacity="${o}"`;

/** Three bands, the logo's body: one color, fading. */
function bands(x, y, w, bh, gap, cls = C.deep, fades = [1, 0.72, 0.45]) {
  return fades
    .map((o, i) => rect(x, y + i * (bh + gap), w, bh, bh / 2, cls, o === 1 ? "" : op(o)))
    .join("");
}

/** The shackle as a filled shape: a rounded arch of thickness t. */
function shackle(cx, bottom, w, h, t, cls = C.deep, lift = 0, shift = 0) {
  const R = w / 2;
  const r = R - t;
  const top = bottom - h - lift;
  const left = cx - R + shift;
  const legBottom = bottom - lift;
  return path_(
    `M${n(left)} ${n(legBottom)}V${n(top + R)}A${n(R)} ${n(R)} 0 0 1 ${n(left + 2 * R)} ${n(top + R)}V${n(legBottom)}` +
      `H${n(left + 2 * R - t)}V${n(top + R)}A${n(r)} ${n(r)} 0 0 0 ${n(left + t)} ${n(top + R)}V${n(legBottom)}Z`,
    cls,
  );
}

/** The padlock: shackle over a three-band body. */
function lock(cx, cy, s, { open = false, cls = C.deep } = {}) {
  const w = 44 * s;
  const bh = 9 * s;
  const gap = 3 * s;
  const bodyTop = cy - (3 * bh + 2 * gap) / 2 + 6 * s;
  return (
    shackle(cx, bodyTop + 2 * s, 26 * s, 20 * s, 5.5 * s, cls, open ? 9 * s : 0, open ? 9 * s : 0) +
    bands(cx - w / 2, bodyTop, w, bh, gap, cls) +
    circle(cx, bodyTop + bh / 2, 2 * s, C.white)
  );
}

/** A soft pad behind a drawing. */
const pad = (cx, cy, r) => circle(cx, cy, r, C.pale);
const padRect = (x, y, w, h) => rect(x, y, w, h, Math.min(w, h) / 2.4, C.pale);

/** A browser or app window: white body, a band of a title bar with dots. */
function windowCard(x, y, w, h, s = 1) {
  const bar = 10 * s;
  return (
    rect(x, y, w, h, 7 * s, C.white) +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(7 * s)}" fill="none" stroke-width="${n(1.2 * s)}" class="tw-stroke-illustration-outline" stroke-opacity="0.18"/>` +
    rect(x, y, w, bar + 4 * s, 7 * s, C.mint) +
    rect(x, y + bar, w, 4 * s, 0, C.mint) +
    [0, 1, 2]
      .map((i) => circle(x + w - (8 + i * 6) * s, y + (bar + 4 * s) / 2, 1.8 * s, C.white))
      .join("")
  );
}

/** Lines of text as bands. */
function lines(x, y, widths, bh, gap, cls = C.mint) {
  return widths.map((w, i) => rect(x, y + i * (bh + gap), w, bh, bh / 2, cls)).join("");
}

/** A person: a head and shoulders. */
function person(cx, cy, s, cls = C.deep) {
  return (
    circle(cx, cy - 9 * s, 7 * s, cls) +
    path_(
      `M${n(cx - 15 * s)} ${n(cy + 14 * s)}a${n(15 * s)} ${n(13 * s)} 0 0 1 ${n(30 * s)} 0Z`,
      cls,
    )
  );
}

/** Badges: a circle with a check, a plus, an x, or an exclamation mark. */
function badge(cx, cy, r, kind, cls = C.deep) {
  const s = r / 10;
  const mark = {
    check: `<path d="M${n(cx - 5 * s)} ${n(cy)}l${n(3.2 * s)} ${n(3.4 * s)}l${n(6.6 * s)} ${n(-7.2 * s)}" fill="none" stroke-width="${n(2.6 * s)}" stroke-linecap="round" stroke-linejoin="round" class="tw-stroke-illustration-tertiary"/>`,
    plus:
      rect(cx - 1.4 * s, cy - 5.5 * s, 2.8 * s, 11 * s, 1.4 * s, C.white) +
      rect(cx - 5.5 * s, cy - 1.4 * s, 11 * s, 2.8 * s, 1.4 * s, C.white),
    x:
      `<g transform="rotate(45 ${n(cx)} ${n(cy)})">` +
      rect(cx - 1.4 * s, cy - 5.5 * s, 2.8 * s, 11 * s, 1.4 * s, C.white) +
      rect(cx - 5.5 * s, cy - 1.4 * s, 11 * s, 2.8 * s, 1.4 * s, C.white) +
      `</g>`,
    alert:
      rect(cx - 1.4 * s, cy - 5.5 * s, 2.8 * s, 7 * s, 1.4 * s, C.ink) +
      circle(cx, cy + 4.3 * s, 1.6 * s, C.ink),
  }[kind];
  const fill = kind === "alert" ? C.amber : cls;
  return circle(cx, cy, r, fill) + mark;
}

/** A four-point sparkle. */
function sparkle(cx, cy, s, cls = C.amber) {
  return path_(
    `M${n(cx)} ${n(cy - 6 * s)}Q${n(cx + 1.2 * s)} ${n(cy - 1.2 * s)} ${n(cx + 6 * s)} ${n(cy)}Q${n(cx + 1.2 * s)} ${n(cy + 1.2 * s)} ${n(cx)} ${n(cy + 6 * s)}` +
      `Q${n(cx - 1.2 * s)} ${n(cy + 1.2 * s)} ${n(cx - 6 * s)} ${n(cy)}Q${n(cx - 1.2 * s)} ${n(cy - 1.2 * s)} ${n(cx)} ${n(cy - 6 * s)}Z`,
    cls,
  );
}

/** An envelope with a letter of bands peeking out. */
function envelope(x, y, w, h, { code = false } = {}) {
  const s = w / 70;
  const letter =
    rect(x + 9 * s, y - 12 * s, w - 18 * s, h * 0.9, 5 * s, C.white) +
    (code
      ? [0, 1, 2, 3, 4, 5]
          .map((i) =>
            rect(
              x + 14 * s + i * 7.4 * s,
              y - 2 * s,
              5.6 * s,
              7 * s,
              1.6 * s,
              C.deep,
              op(i < 3 ? 1 : 0.55),
            ),
          )
          .join("")
      : lines(x + 15 * s, y - 5 * s, [40 * s, 40 * s, 26 * s], 4.4 * s, 3.2 * s, C.deep));
  return (
    rect(x, y, w, h, 7 * s, C.deep) +
    letter +
    path_(
      `M${n(x)} ${n(y + 12 * s)}L${n(x + w / 2)} ${n(y + h * 0.6)}L${n(x + w)} ${n(y + 12 * s)}V${n(y + h - 7 * s)}a${n(7 * s)} ${n(7 * s)} 0 0 1 ${n(-7 * s)} ${n(7 * s)}H${n(x + 7 * s)}a${n(7 * s)} ${n(7 * s)} 0 0 1 ${n(-7 * s)} ${n(-7 * s)}Z`,
      C.mint,
    )
  );
}

/** A key: a round head with a hole, a shaft, two teeth. */
function key(x, y, s, cls = C.amber, angle = 0) {
  return (
    `<g transform="rotate(${angle} ${n(x)} ${n(y)})">` +
    path_(
      `M${n(x)} ${n(y - 9 * s)}a${n(9 * s)} ${n(9 * s)} 0 1 1 0 ${n(18 * s)}a${n(9 * s)} ${n(9 * s)} 0 1 1 0 ${n(-18 * s)}Zm0 ${n(5 * s)}a${n(4 * s)} ${n(4 * s)} 0 1 0 0 ${n(8 * s)}a${n(4 * s)} ${n(4 * s)} 0 1 0 0 ${n(-8 * s)}Z`,
      cls,
      ' fill-rule="evenodd"',
    ) +
    rect(x + 7 * s, y - 2.5 * s, 26 * s, 5 * s, 2.5 * s, cls) +
    rect(x + 22 * s, y, 4 * s, 8 * s, 1.5 * s, cls) +
    rect(x + 29 * s, y, 4 * s, 6 * s, 1.5 * s, cls) +
    `</g>`
  );
}

/** A phone: a deep frame and a white screen. */
function phone(x, y, w, h, s = 1) {
  return (
    rect(x, y, w, h, 7 * s, C.deep) +
    rect(x + 3.5 * s, y + 7 * s, w - 7 * s, h - 14 * s, 3.5 * s, C.white)
  );
}

/** A magnifying glass. */
function magnifier(cx, cy, r, s = 1) {
  const t = r * 0.32;
  return (
    `<g transform="rotate(45 ${n(cx)} ${n(cy)})">` +
    rect(cx - t / 2, cy + r * 0.8, t, r * 1.15, t / 2, C.deep) +
    `</g>` +
    circle(cx, cy, r, C.deep) +
    circle(cx, cy, r * 0.72, C.white)
  );
}

/** A gear with rounded teeth. */
function gear(cx, cy, r, teeth = 8, cls = C.deep) {
  const parts = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i * 360) / teeth;
    parts.push(
      `<g transform="rotate(${n(a)} ${n(cx)} ${n(cy)})">${rect(cx - r * 0.2, cy - r * 1.18, r * 0.4, r * 0.5, r * 0.12, cls)}</g>`,
    );
  }
  return parts.join("") + circle(cx, cy, r * 0.9, cls) + circle(cx, cy, r * 0.38, C.white);
}

/** Fingerprint ridges: concentric arcs in brand green. */
function fingerprint(cx, cy, r) {
  const arcs = [];
  const sw = r * 0.09;
  for (let i = 1; i <= 4; i++) {
    const rr = (r * i) / 4.4;
    const gapTop = i % 2 ? 0.18 : 0.32;
    arcs.push(
      `<path d="M${n(cx - rr)} ${n(cy + rr * 0.55)}V${n(cy)}A${n(rr)} ${n(rr)} 0 0 1 ${n(cx + rr)} ${n(cy)}V${n(cy + rr * (0.9 - gapTop))}" fill="none" stroke="currentColor" stroke-width="${n(sw)}" stroke-linecap="round"/>`,
    );
  }
  return `<g class="tw-text-fg-brand">${arcs.join("")}<path d="M${n(cx)} ${n(cy - r * 0.05)}V${n(cy + r * 0.7)}" fill="none" stroke="currentColor" stroke-width="${n(sw)}" stroke-linecap="round"/></g>`;
}

/** A paper plane with a trail of bands. */
function plane(x, y, s, trail = true) {
  return (
    (trail ? bands(x - 38 * s, y + 4 * s, 26 * s, 6 * s, 4 * s, C.mint) : "") +
    path_(
      `M${n(x)} ${n(y + 8 * s)}L${n(x + 46 * s)} ${n(y - 14 * s)}L${n(x + 30 * s)} ${n(y + 30 * s)}L${n(x + 20 * s)} ${n(y + 16 * s)}Z`,
      C.deep,
    ) +
    path_(
      `M${n(x + 20 * s)} ${n(y + 16 * s)}L${n(x + 46 * s)} ${n(y - 14 * s)}L${n(x + 15 * s)} ${n(y + 12 * s)}Z`,
      C.mint,
    )
  );
}

/** A folder. */
function folder(x, y, w, h, s = 1) {
  return (
    path_(
      `M${n(x)} ${n(y + 6 * s)}a${n(6 * s)} ${n(6 * s)} 0 0 1 ${n(6 * s)} ${n(-6 * s)}H${n(x + w * 0.38)}l${n(7 * s)} ${n(8 * s)}H${n(x + w - 6 * s)}a${n(6 * s)} ${n(6 * s)} 0 0 1 ${n(6 * s)} ${n(6 * s)}V${n(y + h - 6 * s)}a${n(6 * s)} ${n(6 * s)} 0 0 1 ${n(-6 * s)} ${n(6 * s)}H${n(x + 6 * s)}a${n(6 * s)} ${n(6 * s)} 0 0 1 ${n(-6 * s)} ${n(-6 * s)}Z`,
      C.mint,
    ) + rect(x, y + 16 * s, w, h - 16 * s, 6 * s, C.deep)
  );
}

/** A building: a block with three band floors. */
function building(x, y, w, h, s = 1) {
  return (
    rect(x, y, w, h, 6 * s, C.deep) +
    [0, 1, 2]
      .map((i) =>
        rect(
          x + 7 * s,
          y + 10 * s + i * 14 * s,
          w - 14 * s,
          7 * s,
          3.5 * s,
          C.white,
          op(1 - i * 0.2),
        ),
      )
      .join("") +
    rect(x + w / 2 - 6 * s, y + h - 16 * s, 12 * s, 16 * s, 3 * s, C.amber)
  );
}

/** A credit card. */
function cardShape(x, y, w, h, s = 1, cls = C.deep) {
  return (
    rect(x, y, w, h, 6 * s, cls) +
    rect(x, y + h * 0.22, w, h * 0.16, 0, C.ink, op(0.35)) +
    rect(x + 7 * s, y + h * 0.52, 12 * s, 9 * s, 2.5 * s, C.amber) +
    rect(x + 7 * s, y + h * 0.8, w * 0.45, 4 * s, 2 * s, C.white, op(0.8))
  );
}

/** A clock. */
function clock(cx, cy, r) {
  return (
    circle(cx, cy, r, C.deep) +
    circle(cx, cy, r * 0.8, C.white) +
    rect(cx - r * 0.07, cy - r * 0.55, r * 0.14, r * 0.6, r * 0.07, C.ink) +
    `<g transform="rotate(60 ${n(cx)} ${n(cy)})">${rect(cx - r * 0.07, cy - r * 0.42, r * 0.14, r * 0.47, r * 0.07, C.ink)}</g>` +
    circle(cx, cy, r * 0.1, C.amber)
  );
}

/** A tab bar icon: 24 by 24, drawn in the label's color (currentColor), the
 *  active one with a soft brand fill behind. */
const icon = (body, fill = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" data-art="passbundle">${fill}<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">${body}</g></svg>`;

// Drawings: each [symbol, viewBox, content], content in the viewBox's units.
const art = {};
function draw(symbol, viewBox, content) {
  const [x, y] = viewBox.split(" ").map(Number);
  art[symbol] =
    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${viewBox}" data-art="passbundle"><g transform="translate(${x} ${y})">${content}</g></svg>`;
}

draw(
  "LockIcon",
  "0 0 80 73.33",
  pad(40, 40, 33) + lock(40, 40, 1) + sparkle(68, 14, 0.9) + sparkle(12, 22, 0.6),
);
draw(
  "UnlockedIcon",
  "0 0.99 80 73.35",
  pad(40, 40, 33) + lock(40, 42, 1, { open: true }) + sparkle(14, 16, 0.8) + sparkle(70, 52, 0.6),
);
draw(
  "VaultIcon",
  "0 8.33 80 66.67",
  padRect(4, 4, 72, 58) +
    rect(14, 9, 52, 46, 8, C.deep) +
    rect(19, 14, 42, 36, 5, C.white) +
    bands(25, 20, 30, 6, 3.5, C.deep) +
    circle(53, 46, 4.5, C.amber) +
    rect(20, 55, 8, 5, 2, C.deep) +
    rect(52, 55, 8, 5, 2, C.deep),
);
draw(
  "VaultOpen",
  "0 10 96 80",
  padRect(4, 4, 88, 72) +
    rect(18, 10, 52, 54, 8, C.deep) +
    rect(23, 15, 42, 44, 5, C.white) +
    bands(29, 22, 30, 7, 4, C.deep) +
    path_("M70 12l18 6v44l-18 6Z", C.mint) +
    circle(80, 40, 3.5, C.amber) +
    sparkle(14, 18, 0.8) +
    sparkle(86, 8, 0.6),
);
draw(
  "NoResults",
  "4 4.5 91.63 88",
  padRect(4, 6, 84, 74) +
    [0, 1, 2].map((i) => rect(14, 18 + i * 16, 52, 10, 5, C.mint, op(0.5 - i * 0.12))).join("") +
    magnifier(56, 40, 17),
);
draw(
  "NoFolders",
  "2 12.5 93.63 72",
  padRect(2, 2, 88, 68) + folder(16, 12, 58, 46) + badge(72, 18, 9, "plus"),
);
draw(
  "NoCredentialsIcon",
  "0 1.49 96 94.02",
  pad(48, 48, 42) +
    [0, 1, 2].map((i) => rect(20, 22 + i * 14, 56, 9, 4.5, C.white, op(1 - i * 0.25))).join("") +
    key(30, 70, 1.05, C.deep, -10) +
    sparkle(80, 18, 0.8),
);
draw("NoSendsIcon", "9 4 83.89 91", pad(42, 46, 38) + plane(30, 44, 0.95) + sparkle(70, 20, 0.7));
draw(
  "ActiveSendIcon",
  "5 4 87 87",
  pad(43, 44, 38) + plane(30, 44, 0.95) + badge(68, 66, 11, "check"),
);
draw(
  "EmptyTrash",
  "0.22 7 95.71 88",
  padRect(4, 4, 88, 80) +
    rect(26, 16, 44, 8, 4, C.deep) +
    rect(40, 10, 16, 8, 3, C.deep) +
    path_("M29 28h38l-4 44a6 6 0 0 1-6 5H39a6 6 0 0 1-6-5Z", C.mint) +
    bands(38, 38, 20, 5, 6, C.white) +
    badge(70, 68, 10, "check"),
);
draw(
  "Party",
  "3.76 4 88.24 88.24",
  pad(44, 44, 38) +
    `<g transform="rotate(-35 44 44)">` +
    bands(22, 30, 44, 9, 4, C.deep) +
    `</g>` +
    sparkle(70, 16, 1) +
    sparkle(18, 22, 0.7) +
    sparkle(72, 68, 0.6) +
    circle(24, 70, 3.5, C.amber) +
    circle(60, 12, 2.5, C.mint) +
    circle(80, 42, 3, C.mint),
);
draw(
  "WaveIcon",
  "3.33 3.33 73.33 73.33",
  pad(37, 37, 33) +
    path_(
      "M14 20a8 8 0 0 1 8-8h32a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H32l-12 10V50h0a8 8 0 0 1-6-8Z",
      C.deep,
    ) +
    lines(22, 22, [30, 30, 18], 5, 4, C.white) +
    sparkle(64, 58, 0.8),
);
draw(
  "FavoritesIcon",
  "5.29 4.98 86.89 90.19",
  padRect(4, 6, 80, 78) +
    lines(16, 50, [52, 40], 8, 6, C.mint) +
    path_(
      "M44 10l7.6 15.4 17 2.5-12.3 12 2.9 16.9L44 48.8l-15.2 8 2.9-16.9-12.3-12 17-2.5Z",
      C.amber,
    ),
);
draw(
  "Security",
  "4 4 88 89",
  pad(44, 45, 40) +
    path_("M44 8l28 10v22c0 20-12 34-28 42C28 74 16 60 16 40V18Z", C.deep) +
    path_("M44 16l20 7v17c0 15-9 26-20 32-11-6-20-17-20-32V23Z", C.mint) +
    lock(44, 46, 0.55),
);
draw(
  "RegistrationCheckEmailIcon",
  "3.33 0.87 76.36 76.8",
  pad(38, 40, 34) + envelope(6, 28, 64, 40) + sparkle(66, 14, 0.7),
);
draw(
  "TwoFactorAuthEmailIcon",
  "3.33 0.46 73.33 76.8",
  pad(36, 40, 33) + envelope(4, 28, 64, 40, { code: true }),
);
draw(
  "RegistrationUserAddIcon",
  "0 10 80 60",
  padRect(2, 2, 76, 56) +
    windowCard(8, 8, 46, 34) +
    lines(14, 26, [30, 22], 4, 4) +
    person(58, 34, 0.9) +
    badge(30, 46, 9, "plus"),
);
draw(
  "UserLockIcon",
  "0 10 80 60",
  padRect(2, 2, 76, 56) + windowCard(8, 8, 46, 34) + lock(28, 30, 0.42) + person(60, 34, 0.9),
);
draw(
  "UserVerificationBiometricsIcon",
  "4 4 88 88",
  pad(44, 44, 40) +
    circle(44, 42, 24, C.white) +
    fingerprint(44, 40, 20) +
    badge(66, 66, 10, "check"),
);
draw(
  "BiometricFingerprint",
  "0 0 97 97",
  pad(48.5, 48.5, 44) + circle(48.5, 47, 30, C.white) + fingerprint(48.5, 45, 25),
);
draw(
  "TwoFactorAuthAuthenticatorIcon",
  "0 10 80 66.67",
  padRect(2, 2, 76, 62) +
    phone(26, 6, 28, 54) +
    [0, 1, 2].map((i) => rect(31 + i * 6.4, 24, 5, 7, 1.5, C.deep)).join("") +
    [0, 1, 2].map((i) => rect(31 + i * 6.4, 34, 5, 7, 1.5, C.deep, op(0.55))).join("") +
    circle(62, 18, 8, C.amber) +
    rect(61, 13, 2, 6, 1, C.ink) +
    rect(61, 17, 5, 2, 1, C.ink),
);
draw(
  "TwoFactorAuthSecurityKeyIcon",
  "3.33 10 71.27 66.67",
  padRect(2, 2, 68, 62) +
    rect(24, 8, 22, 12, 3, C.mint) +
    rect(18, 18, 34, 42, 9, C.deep) +
    circle(35, 39, 7, C.amber) +
    rect(29, 52, 12, 3, 1.5, C.white, op(0.7)),
);
draw(
  "TwoFactorAuthSecurityKeyFailedIcon",
  "4.72 12.85 92 80",
  padRect(4, 2, 84, 74) +
    rect(30, 10, 22, 12, 3, C.mint) +
    rect(24, 20, 34, 44, 9, C.deep) +
    circle(41, 42, 7, C.mint) +
    badge(68, 58, 11, "alert"),
);
draw(
  "TwoFactorAuthWebAuthnIcon",
  "3.33 3.33 76.49 75.83",
  pad(38, 38, 34) +
    phone(16, 10, 30, 54) +
    fingerprint(31, 36, 11) +
    key(52, 56, 0.6, C.amber, -30),
);
draw(
  "TwoFactorTimeoutIcon",
  "5 4 87 87",
  pad(43, 44, 38) + clock(42, 44, 24) + badge(66, 22, 10, "x", C.ink),
);
draw(
  "DevicesIcon",
  "0 10 80 60",
  padRect(2, 2, 76, 56) +
    rect(10, 10, 46, 30, 5, C.deep) +
    rect(14, 14, 38, 22, 3, C.white) +
    rect(4, 40, 58, 6, 3, C.mint) +
    lock(33, 25, 0.32) +
    phone(56, 20, 18, 32, 0.6) +
    bands(60, 30, 10, 3, 2, C.deep),
);
draw(
  "DomainIcon",
  "0.52 0.12 120 120",
  pad(60, 60, 54) +
    circle(60, 58, 36, C.deep) +
    `<g stroke-width="3.4" fill="none" class="tw-stroke-illustration-tertiary"><ellipse cx="60" cy="58" rx="16" ry="36"/><path d="M24 58h72M30 40h60M30 76h60"/></g>` +
    badge(88, 88, 13, "check"),
);
draw(
  "BrowserExtensionIcon",
  "0 14.58 100 75",
  padRect(2, 2, 96, 71) +
    windowCard(10, 10, 80, 54, 1.1) +
    lines(18, 34, [44, 34, 50], 5, 5) +
    rect(64, 28, 20, 20, 6, C.deep) +
    lock(74, 38, 0.3, { cls: C.white }),
);
draw(
  "ExtensionMockLogin",
  "0 0 684 291",
  rect(0, 0, 684, 291, 18, C.pale) +
    windowCard(28, 24, 420, 250, 2.2) +
    lines(64, 96, [180, 260], 14, 18) +
    rect(64, 160, 260, 34, 10, C.white) +
    rect(64, 206, 120, 34, 17, C.deep) +
    rect(400, 40, 256, 214, 18, C.white) +
    rect(400, 40, 256, 44, 18, C.mint) +
    rect(400, 70, 256, 14, 0, C.mint) +
    lock(428, 62, 0.35) +
    [0, 1, 2]
      .map(
        (i) =>
          rect(420, 100 + i * 48, 216, 38, 12, C.pale) +
          circle(442, 119 + i * 48, 10, C.deep, op(1 - i * 0.25)) +
          rect(460, 112 + i * 48, 120, 7, 3.5, C.deep, op(0.8)) +
          rect(460, 124 + i * 48, 80, 6, 3, C.mint),
      )
      .join(""),
);
draw(
  "AutoConfirmSvg",
  "0 0 197 232",
  rect(0, 0, 197, 232, 20, C.pale) +
    rect(18, 20, 161, 192, 16, C.white) +
    lines(34, 38, [90, 60], 8, 8, C.deep) +
    [0, 1, 2]
      .map(
        (i) =>
          person(52, 104 + i * 40, 0.55) +
          rect(70, 96 + i * 40, 60, 7, 3.5, C.deep, op(0.85)) +
          rect(70, 108 + i * 40, 40, 6, 3, C.mint) +
          badge(156, 104 + i * 40, 9, "check"),
      )
      .join(""),
);
draw(
  "AccountWarning",
  "0 12.75 96 72",
  padRect(2, 2, 92, 68) +
    windowCard(10, 8, 54, 40) +
    lines(16, 28, [36, 26], 5, 5) +
    person(70, 40, 1) +
    badge(30, 52, 11, "alert"),
);
draw(
  "DeactivatedOrg",
  "4 0.5 90.32 96",
  pad(45, 48, 42) + building(24, 18, 42, 62) + badge(68, 70, 11, "alert"),
);
draw(
  "BusinessWelcome",
  "4.17 0.75 91.67 95.83",
  pad(46, 48, 42) +
    building(25, 18, 42, 62) +
    sparkle(76, 22, 1) +
    sparkle(16, 34, 0.7) +
    badge(70, 72, 10, "check"),
);
draw(
  "CreditCardIcon",
  "0.98 15.86 95.04 65.76",
  padRect(2, 2, 91, 62) + cardShape(30, 8, 54, 34, 1, C.mint) + cardShape(10, 22, 54, 34),
);
draw(
  "ItemTypes",
  "0 18.75 150 112.5",
  padRect(4, 4, 142, 104) +
    rect(18, 14, 52, 38, 10, C.white) +
    key(32, 33, 0.65, C.deep) +
    rect(80, 14, 52, 38, 10, C.white) +
    cardShape(88, 22, 36, 22, 0.6) +
    rect(18, 60, 52, 38, 10, C.white) +
    person(36, 82, 0.55) +
    lines(46, 74, [16, 12], 4, 4) +
    rect(80, 60, 52, 38, 10, C.white) +
    lines(90, 70, [32, 32, 20], 5, 5, C.deep),
);
draw(
  "LoginCards",
  "6.25 6.25 137.5 137.5",
  pad(69, 69, 62) +
    rect(36, 24, 70, 44, 10, C.mint) +
    rect(26, 40, 86, 52, 12, C.white) +
    circle(46, 66, 9, C.deep) +
    lines(62, 58, [36, 26], 6, 6, C.deep) +
    key(92, 104, 0.8, C.amber, -20),
);
draw(
  "GearIcon",
  "4.8 6 110.4 107.52",
  pad(55, 54, 50) + gear(55, 54, 30) + bands(45, 48, 20, 4, 2.5, C.deep) + sparkle(94, 20, 0.9),
);
draw(
  "SpotReport",
  "0 0 120 120",
  pad(60, 60, 54) +
    rect(30, 20, 60, 78, 10, C.white) +
    [0, 1, 2, 3]
      .map((i) =>
        rect(
          40 + i * 11,
          76 - [18, 30, 22, 38][i],
          7,
          [18, 30, 22, 38][i],
          3.5,
          C.deep,
          op(i === 3 ? 1 : 0.6),
        ),
      )
      .join("") +
    lines(40, 84, [40], 5, 0) +
    sparkle(98, 22, 0.9),
);
draw(
  "ReportBreach",
  "11.6 3.33 56.67 73.33",
  padRect(2, 2, 52, 70) +
    rect(8, 8, 36, 50, 7, C.white) +
    lines(14, 16, [24, 18, 22], 4, 4) +
    badge(38, 54, 11, "alert"),
);
draw(
  "ReportExposedPasswords",
  "0.7 2.4 79.3 77.2",
  pad(40, 40, 36) +
    windowCard(6, 12, 54, 40) +
    [0, 1, 2, 3, 4].map((i) => circle(16 + i * 8, 36, 2.6, C.deep)).join("") +
    magnifier(60, 54, 11),
);
draw(
  "ReportUnsecuredWebsites",
  "0.4 10.07 79.2 60",
  padRect(2, 2, 76, 56) +
    windowCard(8, 8, 60, 42) +
    lock(38, 32, 0.4, { open: true, cls: C.amber }),
);
draw(
  "RestrictedView",
  "5.52 2.62 110 110",
  pad(55, 55, 50) +
    path_("M18 56c10-16 22-24 37-24s27 8 37 24c-10 16-22 24-37 24S28 72 18 56Z", C.white) +
    circle(55, 56, 13, C.deep) +
    circle(55, 56, 5, C.white) +
    `<g transform="rotate(-40 55 56)">${rect(18, 52, 74, 7, 3.5, C.amber)}</g>`,
);
draw(
  "SsoKeyIcon",
  "0 12.12 96 76",
  padRect(2, 2, 92, 72) +
    path_("M26 52a14 14 0 0 1 2-28 18 18 0 0 1 34-4 13 13 0 0 1 8 25Z", C.white) +
    key(32, 56, 1, C.deep, -25) +
    sparkle(80, 14, 0.7),
);
draw(
  "BackgroundLeftIllustration",
  "0 0 501 226",
  [0, 1, 2]
    .map((i) => rect(40 + i * 40, 50 + i * 40, 300, 30, 15, C.mint, op(0.55 - i * 0.12)))
    .join("") +
    lock(380, 110, 2.1, { cls: C.mint }) +
    sparkle(450, 40, 2) +
    sparkle(60, 190, 1.4) +
    circle(250, 26, 6, C.amber, op(0.8)),
);
draw(
  "BackgroundRightIllustration",
  "0 0 506 297",
  [0, 1, 2]
    .map((i) => rect(170 - i * 40, 170 + i * 36, 300, 26, 13, C.mint, op(0.55 - i * 0.12)))
    .join("") +
    `<g opacity="0.85">${plane(150, 90, 2.2, false)}</g>` +
    key(380, 70, 1.8, C.mint, -20) +
    sparkle(60, 50, 1.6) +
    circle(460, 250, 7, C.amber, op(0.8)),
);

// Tab bar icons.
const vaultBody = `<rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8v1.2M12 14v1.2"/>`;
const generatorBody = `<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>`;
const sendBody = `<path d="M3.5 11.2 20.5 4l-6.6 16-3.2-6.3-7.2-2.5Z"/><path d="m10.7 13.7 4.2-4.2"/>`;
// A cog: eight teeth around a ring, as one outline.
const cog = (() => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    for (const [da, r] of [
      [-0.24, 7.2],
      [-0.15, 9.4],
      [0.15, 9.4],
      [0.24, 7.2],
    ]) {
      pts.push(`${n(12 + r * Math.sin(a + da))} ${n(12 - r * Math.cos(a + da))}`);
    }
  }
  return `M${pts.join("L")}Z`;
})();
const settingsBody = `<path d="${cog}"/><circle cx="12" cy="12" r="3"/>`;
const healthBody = `<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/><path d="M7.5 12.5h2.6l1.4-2.4 1.8 4 1.2-1.6h2"/>`;
const fill = (shape) => shape.replace(/\/>$/, ` class="tw-fill-fg-brand-soft"/>`);
art.VaultInactive = icon(vaultBody);
art.VaultActive = icon(vaultBody, fill(`<rect x="3" y="4" width="18" height="16" rx="3.5"/>`));
art.GeneratorInactive = icon(generatorBody);
art.GeneratorActive = icon(
  generatorBody,
  fill(`<rect x="3" y="4" width="18" height="16" rx="5"/>`),
);
art.SendInactive = icon(sendBody);
art.SendActive = icon(sendBody, fill(`<path d="M3.5 11.2 20.5 4l-6.6 16-3.2-6.3-7.2-2.5Z"/>`));
art.SettingsInactive = icon(settingsBody);
art.SettingsActive = icon(settingsBody, fill(`<path d="${cog}"/>`));
art.HealthInactive = icon(healthBody);
art.HealthActive = icon(
  healthBody,
  fill(
    `<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/>`,
  ),
);

for (const old of fs.readdirSync(here).filter((f) => f.endsWith(".svg")))
  fs.rmSync(path.join(here, old));
for (const [symbol, svg] of Object.entries(art))
  fs.writeFileSync(path.join(here, `${symbol}.svg`), svg + "\n");
console.log(`artwork: ${Object.keys(art).length} drawings`);
