import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { BUILT_IN_TEMPLATES, templateFields } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { KeykeeperItemHeroComponent } from "./item-hero.component";
import { KeykeeperItemTileComponent } from "./item-tile.component";

@Component({
  selector: "vault-keykeeper-item-tile",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ItemTileStubComponent {
  readonly cipher = input<CipherView>();
  readonly hero = input<boolean>();
}

describe("KeykeeperItemHeroComponent", () => {
  let fixture: ComponentFixture<KeykeeperItemHeroComponent>;

  const el = () => fixture.nativeElement as HTMLElement;
  const where = () =>
    el().querySelector('[data-testid="keykeeper-item-where"]')?.textContent?.trim();

  const item = (type: CipherType, name: string) => {
    const cipher = new CipherView();
    cipher.type = type;
    cipher.name = name;
    return cipher;
  };

  function render(
    cipher: CipherView,
    extra: {
      organization?: Organization;
      folder?: FolderView;
      collections?: CollectionView[];
    } = {},
  ) {
    fixture = TestBed.createComponent(KeykeeperItemHeroComponent);
    fixture.componentRef.setInput("cipher", cipher);
    for (const [key, value] of Object.entries(extra)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KeykeeperItemHeroComponent],
      providers: [
        {
          provide: I18nService,
          useValue: {
            t: (key: string, ...args: string[]) =>
              key === "keykeeperItemInVault"
                ? `${args[0]} in ${args[1]}`
                : ({ typeLogin: "Login", typeCard: "Card", typeNote: "Note", myVault: "My vault" }[
                    key
                  ] ?? key),
          },
        },
      ],
    })
      .overrideComponent(KeykeeperItemHeroComponent, {
        remove: { imports: [KeykeeperItemTileComponent] },
        add: { imports: [ItemTileStubComponent] },
      })
      .compileComponents();
  });

  it("names the item as the page's heading, and says what it is and where it lives", () => {
    render(item(CipherType.Login, "Contoso Mail"));

    expect(el().querySelector("h1")?.textContent?.trim()).toBe("Contoso Mail");
    expect(where()).toBe("Login in My vault");
    expect(el().querySelector("vault-keykeeper-category-tile")).not.toBeNull();
  });

  it("names the organization's vault, and the item's folder or collections", () => {
    const organization = { name: "Contoso IT" } as Organization;
    const everyone = { name: "Everyone" } as CollectionView;
    const admins = { name: "Admins" } as CollectionView;
    render(item(CipherType.Card, "Company card"), {
      organization,
      collections: [everyone, admins],
    });
    expect(where()).toBe("Card in Contoso IT · Everyone, Admins");

    const folder = { id: "f1", name: "Banking" } as FolderView;
    render(item(CipherType.Login, "Northwind Bank"), { folder });
    expect(where()).toBe("Login in My vault · Banking");

    render(item(CipherType.Login, "Fabrikam VPN"), {
      folder: { id: null, name: "No folder" } as FolderView,
    });
    expect(where()).toBe("Login in My vault");
  });

  it("says the template an item came from", () => {
    const wifi = item(CipherType.SecureNote, "Home Wi-Fi");
    wifi.fields = templateFields(BUILT_IN_TEMPLATES.find((t) => t.id === "wifi")!);
    render(wifi);

    expect(where()).toBe("Wi-Fi network in My vault");
  });
});
