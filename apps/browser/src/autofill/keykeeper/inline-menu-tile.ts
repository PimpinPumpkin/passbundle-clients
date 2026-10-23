// Keykeeper: the fill menu's item tiles, the same as the popup's (DESIGN.md,
// "The look", in the keykeeper repo): a login shows its site's icon on a
// white tile, or its first letter on a tint of the login color while there's
// no icon; cards, identities, and the rest show their category's jewel tile.
// Colors and glyphs come from libs/common/src/vault/keykeeper/categories.ts;
// the inline menu's list.scss draws them.
import { CipherType } from "@bitwarden/common/vault/enums";
import {
  categoryOfType,
  isServerFallbackIcon,
  KEYKEEPER_CATEGORY_LOOKS,
  tileLetter,
} from "@bitwarden/common/vault/keykeeper/categories";

const SVG_NS = "http://www.w3.org/2000/svg";

export type KeykeeperTileCipher = {
  type: CipherType;
  name: string;
  icon?: { image?: string | null } | null;
};

/** An item's tile for the fill menu: decorative, since its name is beside it. */
export function buildKeykeeperTile(cipher: KeykeeperTileCipher): HTMLElement {
  const tile = globalThis.document.createElement("span");
  tile.classList.add("cipher-icon", "keykeeper-tile");
  tile.setAttribute("aria-hidden", "true");

  const category = categoryOfType(cipher.type);
  const letter = tileLetter(cipher.name);
  if (category === "login" && letter) {
    tile.classList.add("keykeeper-tile-letter");
    tile.textContent = letter;
    const image = siteIcon(cipher.icon?.image);
    if (image) {
      const img = globalThis.document.createElement("img");
      img.alt = "";
      img.addEventListener("load", () => {
        // The server's stand-in for a site without an icon counts as none.
        if (isServerFallbackIcon(img.naturalWidth, img.naturalHeight)) {
          return;
        }
        tile.textContent = "";
        tile.classList.replace("keykeeper-tile-letter", "keykeeper-tile-site");
        tile.append(img);
      });
      img.src = image;
    }
    return tile;
  }

  const look = KEYKEEPER_CATEGORY_LOOKS[category];
  tile.classList.add("keykeeper-tile-jewel");
  tile.dataset.category = category;
  tile.style.setProperty("--pb-jewel", look.light);
  tile.style.setProperty("--pb-jewel-dark", look.dark);
  const svg = globalThis.document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = globalThis.document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", look.glyph);
  svg.append(path);
  tile.append(svg);
  return tile;
}

function siteIcon(image: string | null | undefined): string | null {
  if (!image) {
    return null;
  }
  try {
    return new URL(image).href;
  } catch {
    return null;
  }
}
