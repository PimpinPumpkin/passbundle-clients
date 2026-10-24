import { ComponentFixture, TestBed } from "@angular/core/testing";
import { BehaviorSubject } from "rxjs";

import { DomainSettingsService } from "@bitwarden/common/autofill/services/domain-settings.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { BUILT_IN_TEMPLATES, templateFields } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { KeykeeperItemTileComponent } from "./item-tile.component";

describe("KeykeeperItemTileComponent", () => {
  let fixture: ComponentFixture<KeykeeperItemTileComponent>;
  let showFavicons$: BehaviorSubject<boolean>;

  const el = () => fixture.nativeElement as HTMLElement;
  const tile = () => el().querySelector<HTMLElement>("[data-tile]")!;

  const login = (name: string, uri?: string) => {
    const cipher = new CipherView();
    cipher.type = CipherType.Login;
    cipher.name = name;
    cipher.login = new LoginView();
    if (uri) {
      const u = new LoginUriView();
      u.uri = uri;
      cipher.login.uris = [u];
    }
    return cipher;
  };

  async function render(cipher: CipherView, hero = false) {
    fixture = TestBed.createComponent(KeykeeperItemTileComponent);
    fixture.componentRef.setInput("cipher", cipher);
    fixture.componentRef.setInput("hero", hero);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The site's icon arrives at the given size. */
  function iconLoads(width: number, height: number) {
    const img = el().querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: width });
    Object.defineProperty(img, "naturalHeight", { value: height });
    img.dispatchEvent(new Event("load"));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    showFavicons$ = new BehaviorSubject(true);
    await TestBed.configureTestingModule({
      imports: [KeykeeperItemTileComponent],
      providers: [
        {
          provide: EnvironmentService,
          useValue: {
            environment$: new BehaviorSubject({ getIconsUrl: () => "https://vault.example/icons" }),
          },
        },
        { provide: DomainSettingsService, useValue: { showFavicons$ } },
      ],
    }).compileComponents();
  });

  it("shows a login's first letter until its site's icon arrives, then the icon on white", async () => {
    await render(login("contoso Mail", "https://contoso.example/sign-in"));

    expect(tile().dataset.tile).toBe("letter");
    expect(tile().textContent?.trim()).toBe("C");
    expect(el().querySelector("img")?.getAttribute("src")).toBe(
      "https://vault.example/icons/contoso.example/icon.png",
    );

    iconLoads(32, 32);

    expect(tile().dataset.tile).toBe("site-icon");
    expect(tile().textContent?.trim()).toBe("");
  });

  it("keeps the letter when the server sends its stand-in for a site without an icon", async () => {
    await render(login("Northwind Bank", "https://northwind.example"));

    iconLoads(19, 19);

    expect(tile().dataset.tile).toBe("letter");
    expect(tile().textContent?.trim()).toBe("N");
  });

  it("asks for no icon when site icons are off", async () => {
    showFavicons$.next(false);
    await render(login("Fabrikam VPN", "https://vpn.fabrikam.example"));

    expect(el().querySelector("img")).toBeNull();
    expect(tile().textContent?.trim()).toBe("F");
  });

  it("shows a card's, a note's, and a template's jewel tile", async () => {
    const card = new CipherView();
    card.type = CipherType.Card;
    card.name = "Visa ending 4242";
    await render(card);
    expect(tile().dataset.tile).toBe("category");
    expect(el().querySelector("[data-category]")?.getAttribute("data-category")).toBe("card");

    const wifi = new CipherView();
    wifi.type = CipherType.SecureNote;
    wifi.name = "Home Wi-Fi";
    wifi.fields = templateFields(BUILT_IN_TEMPLATES.find((t) => t.id === "wifi")!);
    await render(wifi);
    expect(el().querySelector("[data-category]")?.getAttribute("data-category")).toBe("wifi");
  });

  it("is bigger at the top of an item's page", async () => {
    await render(login("Contoso Mail"), true);

    expect(tile().style.width).toBe("52px");
    expect(tile().style.height).toBe("52px");
  });
});
