#!/usr/bin/env python3
"""Draws PassBundle's logo as SVG: the jewel tile and the two-tone wordmark.

The tile is a rounded square in the brand's emerald with a soft highlight
and the lock in white. The wordmark is the name in lower case, "pass" bold
and "bundle" lighter, in Google Sans Flex. Its letters are drawn as outlines
(shaped and kerned by HarfBuzz at each weight of the variable font), not as
SVG text, which would show in whatever font the viewer has.

  wordmark.py OUT_DIR

writes, into OUT_DIR (render-assets.sh's assets/generated):
  wordmark-themed.svg  the full logo for the shared logo component (sign-in
                       pages, the extension's), light colors, with classes
                       look.css recolors for dark themes
  logo-nav.svg         the logo in the corner of the navigation, for its
                       dark background (look.css recolors it on a light nav)
  mark-themed.svg      the tile alone: the navigation closed to icons
  web/logo.svg         the full logo as an image, for light backgrounds
  web/logo-white.svg   the same, for dark backgrounds

Needs fontTools, brotli (for .woff2), and uharfbuzz.
"""

import io
import os
import sys

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "assets/fonts/google-sans-flex-latin.woff2")
MARK = open(os.path.join(HERE, "assets/mark.svg")).read().split(' d="')[1].split('"')[0]

EMERALD = "#0E7A5A"
LIGHT = {"pass": "#1B3A33", "bundle": "#0E7A5A"}
DARK = {"pass": "#E7EFEC", "bundle": "#6FD4B4"}

# Proportions of the design, for a 42-unit tile: 12 radius, the lock 18 wide,
# 12 between the tile and the name, the name at 31 with -0.02em tracking.
REF = 42.0


def num(v):
    return f"{round(v, 2):g}"


class DropEmptySegments:
    """Passes a drawing on without segments that go nowhere: the variable
    font's corners collapse to points when it isn't rounded."""

    def __init__(self, out):
        self.out = out
        self.at = None

    @staticmethod
    def _key(point):
        return (round(point[0], 2), round(point[1], 2))

    def moveTo(self, point):
        self.at = self._key(point)
        self.out.moveTo(point)

    def lineTo(self, point):
        if self._key(point) != self.at:
            self.out.lineTo(point)
            self.at = self._key(point)

    def _curve(self, draw, points):
        if points[-1] is not None and all(self._key(p) == self.at for p in points):
            return
        draw(*points)
        if points[-1] is not None:
            self.at = self._key(points[-1])

    def qCurveTo(self, *points):
        self._curve(self.out.qCurveTo, points)

    def curveTo(self, *points):
        self._curve(self.out.curveTo, points)

    def closePath(self):
        self.out.closePath()

    def endPath(self):
        self.out.endPath()


class Font:
    def __init__(self, path):
        font = TTFont(path)
        self.ascender = font["hhea"].ascent
        self.descender = font["hhea"].descent
        font.flavor = None
        out = io.BytesIO()
        font.save(out)
        self.face = hb.Face(out.getvalue())

    def outline(self, text, size, weight, x, y, tracking=0.0):
        """The text as one path from (x, y) on its baseline, and how far it runs
        (tracking, in em, added after each letter, as CSS letter-spacing does)."""
        font = hb.Font(self.face)
        font.set_variations({"wght": weight})
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(font, buf, {"kern": True, "liga": True})
        scale = size / self.face.upem
        svg = SVGPathPen(None, ntos=num)
        pen = DropEmptySegments(svg)
        advance = 0.0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            gx = x + (advance + pos.x_offset) * scale
            gy = y - pos.y_offset * scale
            font.draw_glyph_with_pen(info.codepoint, TransformPen(pen, (scale, 0, 0, -scale, gx, gy)))
            advance += pos.x_advance + tracking * self.face.upem
        return svg.getCommands(), advance * scale

    def baseline(self, center, size):
        """The baseline that centers a line of this size on `center`."""
        return center + (self.ascender + self.descender) / 2 * size / self.face.upem


def rounded_rect(x, y, w, h, r):
    return (
        f"M{num(x + r)} {num(y)}H{num(x + w - r)}A{num(r)} {num(r)} 0 0 1 {num(x + w)} {num(y + r)}"
        f"V{num(y + h - r)}A{num(r)} {num(r)} 0 0 1 {num(x + w - r)} {num(y + h)}"
        f"H{num(x + r)}A{num(r)} {num(r)} 0 0 1 {num(x)} {num(y + h - r)}"
        f"V{num(y + r)}A{num(r)} {num(r)} 0 0 1 {num(x + r)} {num(y)}Z"
    )


def tile(prefix, x, y, size, shadow, tile_class=""):
    """The jewel tile at (x, y): the emerald square, its highlight, a light
    edge on top and a soft shade at the bottom (inset), and, on light
    backgrounds, a soft shadow under it. Then the lock, in white."""
    u = size / REF
    r = 12 * u
    shape = rounded_rect(x, y, size, size, r)
    cls = f' class="{tile_class}"' if tile_class else ""
    defs = (
        f'<radialGradient id="{prefix}-shine" cx=".28" cy=".18" r="1" '
        f'gradientTransform="translate(.28 .18) scale(1.2 .9) translate(-.28 -.18)">'
        f'<stop offset="0" stop-color="#fff" stop-opacity=".32"/>'
        f'<stop offset=".58" stop-color="#fff" stop-opacity="0"/></radialGradient>'
        f'<clipPath id="{prefix}-clip"><path d="{shape}"/></clipPath>'
        f'<filter id="{prefix}-soft" x="-50%" y="-50%" width="200%" height="200%">'
        f'<feGaussianBlur stdDeviation="{num(1.5 * u)}"/></filter>'
    )
    if shadow:
        defs += (
            f'<filter id="{prefix}-shadow" x="-30%" y="-30%" width="160%" height="170%">'
            f'<feDropShadow dx="0" dy="{num(2 * u)}" stdDeviation="{num(3 * u)}" '
            f'flood-color="#10201B" flood-opacity=".25"/></filter>'
        )
    filt = f' filter="url(#{prefix}-shadow)"' if shadow else ""
    # The inset edges: the tile less itself moved a little, inside the tile.
    top = rounded_rect(x, y + 1 * u, size, size, r)
    bottom = rounded_rect(x, y - 2 * u, size, size, r)
    lock = 0.6875 * u  # the lock is 18 of 42 units wide
    lx = x + (size - 26 * lock) / 2
    ly = y + (size - 32 * lock) / 2
    body = (
        f'<path{cls} fill="{EMERALD}" d="{shape}"{filt}/>'
        f'<path fill="url(#{prefix}-shine)" d="{shape}"/>'
        f'<g clip-path="url(#{prefix}-clip)">'
        f'<path fill="#fff" fill-opacity=".35" fill-rule="evenodd" d="{shape}{top}"/>'
        f'<path fill="#000" fill-opacity=".2" fill-rule="evenodd" d="{shape}{bottom}" filter="url(#{prefix}-soft)"/>'
        f"</g>"
        f'<path fill="#fff" fill-rule="evenodd" transform="translate({num(lx)} {num(ly)}) scale({num(lock)})" d="{MARK}"/>'
    )
    return defs, body


def logo(font, prefix, tile_size, width, height, colors, shadow, classes=False):
    """The tile, then the name, centered on the tile, in a width x height box."""
    u = tile_size / REF
    x = 2 * u
    y = (height - tile_size) / 2
    if shadow:
        y -= 2 * u  # room for the shadow under the tile
    size = 31 * u
    base = font.baseline(y + tile_size / 2, size)
    tx = x + tile_size + 12 * u
    pass_d, pass_w = font.outline("pass", size, 700, tx, base, -0.02)
    bundle_d, _ = font.outline("bundle", size, 450, tx + pass_w, base, -0.02)
    defs, body = tile(prefix, x, y, tile_size, shadow, "pb-wm-tile" if classes else "")
    pass_cls = ' class="pb-wm-pass"' if classes else ""
    bundle_cls = ' class="pb-wm-bundle"' if classes else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(width)} {num(height)}" '
        f'fill="none" data-brand="PassBundle">'
        f"<title>PassBundle</title><defs>{defs}</defs>{body}"
        f'<path{pass_cls} fill="{colors["pass"]}" d="{pass_d}"/>'
        f'<path{bundle_cls} fill="{colors["bundle"]}" d="{bundle_d}"/></svg>'
    )


def main():
    out = sys.argv[1]
    font = Font(FONT)
    files = {
        # 284 wide, as upstream's logo: the same size where it's shown.
        "wordmark-themed.svg": logo(font, "pbwm", 42, 284, 52, LIGHT, True, classes=True),
        "web/logo.svg": logo(font, "pbimg", 42, 284, 52, LIGHT, True),
        "web/logo-white.svg": logo(font, "pbimgd", 42, 284, 52, DARK, False),
        # The nav's box is 200x49; the tile is 28 there.
        "logo-nav.svg": logo(font, "pbnav", 28, 200, 49, DARK, False, classes=True),
    }
    defs, body = tile("pbmark", 1, 1, 26, False)
    files["mark-themed.svg"] = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="none" '
        f'data-brand="PassBundle"><defs>{defs}</defs>{body}</svg>'
    )
    for name, svg in files.items():
        with open(os.path.join(out, name), "w") as f:
            f.write(svg)


if __name__ == "__main__":
    main()
