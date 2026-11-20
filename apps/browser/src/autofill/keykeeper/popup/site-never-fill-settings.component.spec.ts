import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { awaitAsync, FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { FillRule } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import { KeykeeperSiteNeverFill } from "../site-never-fill";

import { KeykeeperSiteNeverFillSettingsComponent } from "./site-never-fill-settings.component";

const userId = "user" as UserId;
const key = new SymmetricCryptoKey(new Uint8Array(64)) as UserKey;
const encryptService = mock<EncryptService>();
encryptService.encryptString.mockImplementation(
  async (plain) =>
    new EncString(`2.AAAA|${Buffer.from(plain).toString("base64")}|AAAA`) as EncString,
);
encryptService.decryptString.mockImplementation(async (enc) =>
  Buffer.from(enc.encryptedString!.split("|")[1], "base64").toString(),
);

const never = (id: string, host: string): FillRule => ({
  v: 1,
  host,
  field: { id },
  fill: { from: "never" },
});

describe("KeykeeperSiteNeverFillSettingsComponent", () => {
  let fixture: ComponentFixture<KeykeeperSiteNeverFillSettingsComponent>;
  let state: FakeStateProvider;
  let list: KeykeeperSiteNeverFill;
  const accountService = mockAccountServiceWith(userId);
  const keyService = mock<KeyService>({ userKey$: () => of(key) });

  async function render(t: (key: string, ...values: string[]) => string = () => "") {
    await TestBed.configureTestingModule({
      imports: [KeykeeperSiteNeverFillSettingsComponent],
      providers: [
        { provide: AccountService, useValue: accountService },
        { provide: StateProvider, useValue: state },
        { provide: KeyService, useValue: keyService },
        { provide: EncryptService, useValue: encryptService },
        { provide: I18nService, useValue: { t } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperSiteNeverFillSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await awaitAsync(10);
    fixture.detectChanges();
  }

  const text = () =>
    (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, " ").trim() ?? "";
  const rows = () =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("[data-testid=site-never-fill]"),
    );

  beforeEach(() => {
    state = new FakeStateProvider(accountService);
    list = new KeykeeperSiteNeverFill(state, keyService, encryptService, accountService);
  });

  it("says there are none yet, and how to add one", async () => {
    await render();

    expect(text()).toContain("Fields never filled");
    expect(text()).toContain("None yet.");
    expect(rows()).toHaveLength(0);
  });

  it("lists each field never filled on a site, and removes one", async () => {
    await list.add(never("custno", "bank.example.test"));
    await list.add(never("email", "shop.example.test"));
    await render();

    expect(rows().map((r) => r.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "bank.example.test: the field with id custno gets nothing (never fill)",
      "shop.example.test: the field with id email gets nothing (never fill)",
    ]);

    const remove = rows()[0].querySelector("button") as HTMLButtonElement;
    expect(remove.getAttribute("aria-label")).toBe(
      "Remove the rule: bank.example.test, the field with id custno gets nothing (never fill)",
    );
    remove.click();
    await awaitAsync(10);
    fixture.detectChanges();

    expect(await list.list(userId)).toEqual([never("email", "shop.example.test")]);
    expect(rows()).toHaveLength(1);
  });

  it("says it in the person's language", async () => {
    await list.add(never("custno", "bank.example.test"));
    const german: Record<string, string> = {
      keykeeperNeverFilledFields: "Nie gefüllte Felder",
      keykeeperFillRuleNothing: "nichts (nie füllen)",
    };
    await render((key) => german[key] ?? "");

    expect(text()).toContain("Nie gefüllte Felder");
    expect(text()).toContain(
      "bank.example.test: the field with id custno gets nichts (nie füllen)",
    );
  });
});
