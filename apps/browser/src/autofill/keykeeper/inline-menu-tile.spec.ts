import { CipherType } from "@bitwarden/common/vault/enums";
import { KEYKEEPER_CATEGORY_LOOKS } from "@bitwarden/common/vault/keykeeper/categories";

import { buildKeykeeperTile } from "./inline-menu-tile";

describe("buildKeykeeperTile", () => {
  it("shows a login's first letter on the login tint until its site's icon loads", () => {
    const tile = buildKeykeeperTile({
      type: CipherType.Login,
      name: "contoso Mail",
      icon: { image: "https://icons.example/contoso.example/icon.png" },
    });

    expect(tile.classList).toContain("keykeeper-tile-letter");
    expect(tile.textContent).toBe("C");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
  });

  it("swaps the letter for the site's icon once it loads", () => {
    const created: HTMLImageElement[] = [];
    const createElement = document.createElement.bind(document);
    const spy = jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = createElement(tag);
      if (tag === "img") {
        created.push(element as HTMLImageElement);
      }
      return element;
    });

    const tile = buildKeykeeperTile({
      type: CipherType.Login,
      name: "Contoso Mail",
      icon: { image: "https://icons.example/contoso.example/icon.png" },
    });
    created[0].dispatchEvent(new Event("load"));

    expect(tile.classList).toContain("keykeeper-tile-site");
    expect(tile.textContent).toBe("");
    expect(tile.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.example/contoso.example/icon.png",
    );
    spy.mockRestore();
  });

  it("shows a card's and an identity's category tile, in the category's colors", () => {
    for (const [type, category] of [
      [CipherType.Card, "card"],
      [CipherType.Identity, "identity"],
    ] as const) {
      const tile = buildKeykeeperTile({ type, name: "Visa ending 4242" });

      expect(tile.classList).toContain("keykeeper-tile-jewel");
      expect(tile.dataset.category).toBe(category);
      expect(tile.style.getPropertyValue("--pb-jewel")).toBe(
        KEYKEEPER_CATEGORY_LOOKS[category].light,
      );
      expect(tile.style.getPropertyValue("--pb-jewel-dark")).toBe(
        KEYKEEPER_CATEGORY_LOOKS[category].dark,
      );
      expect(tile.querySelector("path")?.getAttribute("d")).toBe(
        KEYKEEPER_CATEGORY_LOOKS[category].glyph,
      );
    }
  });

  it("shows the login tile when a login's name has no letter to show", () => {
    const tile = buildKeykeeperTile({ type: CipherType.Login, name: "  ---  " });

    expect(tile.classList).toContain("keykeeper-tile-jewel");
    expect(tile.dataset.category).toBe("login");
  });
});
