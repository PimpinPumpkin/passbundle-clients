// Keykeeper: someone whose shared folders hide an item's passwords can't
// reveal, copy, or drag any of its secrets from the item's view (DESIGN.md,
// "Folders and permissions"): the password, one-time codes, a card's number
// and code, an SSH key's private key, hidden fields, and earlier passwords.
// The web vault and the extension share these components.
import { Type } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { TextDragDirective } from "@bitwarden/angular/directives/text-drag.directive";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { ViewPasswordHistoryService } from "@bitwarden/common/vault/abstractions/view-password-history.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { HIDDEN_VALUE_MASK } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";
import { SshKeyView } from "@bitwarden/common/vault/models/view/ssh-key.view";
import { ToastService } from "@bitwarden/components";

import { CardDetailsComponent } from "../cipher-view/card-details/card-details-view.component";
import { CustomFieldV2Component } from "../cipher-view/custom-fields/custom-fields-v2.component";
import { ItemHistoryV2Component } from "../cipher-view/item-history/item-history-v2.component";
import { LoginCredentialsViewComponent } from "../cipher-view/login-credentials/login-credentials-view.component";
import { SshKeyViewComponent } from "../cipher-view/sshkey-sections/sshkey-view.component";
import { PasswordHistoryViewComponent } from "../components/password-history-view/password-history-view.component";
import { CopyCipherFieldService } from "../services/copy-cipher-field.service";
import { PasswordRepromptService } from "../services/password-reprompt.service";

const SECRETS = [
  "cipher-password",
  "JBSWY3DPEHPK3PXP",
  "4242424242424242",
  "987",
  "PRIVATE-KEY",
  "old-password",
  "pin-1234",
];

function item(overrides: Partial<CipherView> = {}): CipherView {
  const cipher = new CipherView();
  cipher.id = "cipher-id";
  cipher.name = "Front desk";
  cipher.type = CipherType.Login;
  cipher.login = new LoginView();
  cipher.login.username = "frontdesk";
  cipher.login.password = "cipher-password";
  cipher.login.totp = "JBSWY3DPEHPK3PXP";
  cipher.organizationUseTotp = true;
  cipher.viewPassword = false;
  return Object.assign(cipher, overrides);
}

describe("an item's view, without see passwords", () => {
  async function render<T>(
    component: Type<T>,
    setup: (c: T) => void,
  ): Promise<ComponentFixture<T>> {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        {
          provide: BillingAccountProfileStateService,
          useValue: mock<BillingAccountProfileStateService>({
            hasPremiumFromAnySource$: () => new BehaviorSubject(true),
          }),
        },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "ana" }) } },
        { provide: PremiumUpgradePromptService, useValue: mock<PremiumUpgradePromptService>() },
        { provide: EventCollectionService, useValue: mock<EventCollectionService>() },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
        { provide: I18nService, useValue: { t: (...keys: string[]) => keys.join(" ") } },
        { provide: ConfigService, useValue: mock<ConfigService>() },
        { provide: CipherService, useValue: mock<CipherService>() },
        { provide: ViewPasswordHistoryService, useValue: mock<ViewPasswordHistoryService>() },
        {
          provide: TotpService,
          useValue: { getCode$: () => of({ code: "123456", period: 30 }) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(component);
    setup(fixture.componentInstance);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** Everything the page holds: its text, every input's value, and every drag's data. */
  function exposed(fixture: ComponentFixture<unknown>): string {
    const el = fixture.nativeElement as HTMLElement;
    const values = Array.from(el.querySelectorAll("input, textarea")).map(
      (i) => (i as HTMLInputElement).value,
    );
    const drags = fixture.debugElement
      .queryAll(By.directive(TextDragDirective))
      .map((d) => d.injector.get(TextDragDirective).data ?? "");
    return [el.textContent ?? "", ...values, ...drags].join("\n");
  }

  const expectNoSecrets = (fixture: ComponentFixture<unknown>) => {
    const text = exposed(fixture);
    for (const secret of SECRETS) {
      expect(text).not.toContain(secret);
    }
  };

  const buttons = (fixture: ComponentFixture<unknown>, selector: string) =>
    fixture.debugElement.queryAll(By.css(selector));

  it("login: no way to show, copy, or drag the password or one-time code", async () => {
    const fixture = await render(LoginCredentialsViewComponent, (c) => (c.cipher = item()));
    expectNoSecrets(fixture);
    expect(exposed(fixture)).not.toContain("123456");
    expect(buttons(fixture, '[data-testid="toggle-password"]')).toHaveLength(0);
    expect(buttons(fixture, '[data-testid="copy-password"]')).toHaveLength(0);
    expect(buttons(fixture, '[data-testid="copy-totp"]')).toHaveLength(0);
    expect(buttons(fixture, "[bitTotpCountdown]")).toHaveLength(0);
    const totp = fixture.debugElement.query(By.css('[data-testid="login-totp"]'));
    expect(totp.nativeElement.value).toBe("*** ***");
    expect(totp.nativeElement.type).toBe("password");
  });

  it("login: someone who can see the password still gets its buttons", async () => {
    const cipher = item({ viewPassword: true });
    // (No code here: its countdown sends one during the first check.)
    cipher.login.totp = null;
    const fixture = await render(LoginCredentialsViewComponent, (c) => (c.cipher = cipher));
    expect(buttons(fixture, '[data-testid="toggle-password"]')).toHaveLength(1);
    expect(buttons(fixture, '[data-testid="copy-password"]')).toHaveLength(1);
    const drag = fixture.debugElement.query(By.css("#password-label"));
    expect(drag.injector.get(TextDragDirective).data).toBe("cipher-password");
  });

  it("card: the number and code masked, with nothing to show, copy, or drag", async () => {
    const card = new CardView();
    card.cardholderName = "Ana Example";
    card.number = "4242424242424242";
    card.code = "987";
    const fixture = await render(CardDetailsComponent, (c) => {
      c.cipher = item({ type: CipherType.Card, card });
    });
    expectNoSecrets(fixture);
    expect(exposed(fixture)).toContain(HIDDEN_VALUE_MASK);
    expect(buttons(fixture, '[data-testid="toggle-number"]')).toHaveLength(0);
    expect(buttons(fixture, '[data-testid="copy-number"]')).toHaveLength(0);
    expect(buttons(fixture, '[data-testid="toggle-code"]')).toHaveLength(0);
    expect(buttons(fixture, '[data-testid="copy-code"]')).toHaveLength(0);
    // The name isn't a secret.
    expect(exposed(fixture)).toContain("Ana Example");
  });

  it("SSH key: the private key masked, with nothing to show or copy; the public key stays", async () => {
    const sshKey = new SshKeyView();
    sshKey.privateKey = "PRIVATE-KEY";
    sshKey.publicKey = "ssh-ed25519 AAAA";
    sshKey.keyFingerprint = "SHA256:abc";
    const fixture = await render(SshKeyViewComponent, (c) => {
      c.sshKey = sshKey;
      c.canSeeSecrets = false;
    });
    expectNoSecrets(fixture);
    expect(buttons(fixture, '[data-testid="toggle-privateKey"]')).toHaveLength(0);
    expect(buttons(fixture, 'button[bitIconButton="bwi-clone"]')).toHaveLength(2);
    expect(exposed(fixture)).toContain("ssh-ed25519 AAAA");
  });

  it("hidden fields: masked, nothing to drag, and they don't show when asked", async () => {
    const hidden = new FieldView();
    hidden.name = "PIN";
    hidden.value = "pin-1234";
    hidden.type = FieldType.Hidden;
    const fixture = await render(
      CustomFieldV2Component,
      (c) => (c.cipher = item({ fields: [hidden] })),
    );
    expectNoSecrets(fixture);
    expect(exposed(fixture)).toContain(HIDDEN_VALUE_MASK);
    await fixture.componentInstance.toggleHiddenField(true, 0);
    fixture.detectChanges();
    expectNoSecrets(fixture);
  });

  it("password history: no link to it, and nothing in it", async () => {
    const old = new PasswordHistoryView();
    old.password = "old-password";
    old.lastUsedDate = new Date();
    const cipher = item({ passwordHistory: [old] });

    const history = await render(ItemHistoryV2Component, (c) => (c.cipher = cipher));
    expect(history.nativeElement.textContent).not.toContain("passwordHistory");
    TestBed.resetTestingModule();

    const list = await render(PasswordHistoryViewComponent, (c) => (c.cipher = cipher));
    expectNoSecrets(list);
    expect(list.componentInstance.history).toEqual([]);
  });

  it("password history: someone who can see passwords still gets it", async () => {
    const old = new PasswordHistoryView();
    old.password = "old-password";
    old.lastUsedDate = new Date();
    const history = await render(
      ItemHistoryV2Component,
      (c) => (c.cipher = item({ viewPassword: true, passwordHistory: [old] })),
    );
    expect(history.nativeElement.textContent).toContain("passwordHistory");
  });
});

describe("copying, without see passwords", () => {
  const platformUtilsService = mock<PlatformUtilsService>();
  let service: CopyCipherFieldService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CopyCipherFieldService(
      platformUtilsService,
      mock<ToastService>(),
      mock<EventCollectionService>(),
      mock<PasswordRepromptService>(),
      { getCode$: () => of({ code: "123456", period: 30 }) } as unknown as TotpService,
      { t: (key: string) => key } as I18nService,
      mock<BillingAccountProfileStateService>({ hasPremiumFromAnySource$: () => of(true) }),
      { activeAccount$: of({ id: "ana" }) } as unknown as AccountService,
    );
  });

  it("refuses every secret, whichever button or menu asked", async () => {
    const cipher = item();
    for (const action of [
      "password",
      "totp",
      "cardNumber",
      "securityCode",
      "privateKey",
      "hiddenField",
    ] as const) {
      expect(await service.copy("secret", action, cipher)).toBe(false);
    }
    expect(platformUtilsService.copyToClipboard).not.toHaveBeenCalled();
  });

  it("still copies what isn't secret", async () => {
    expect(await service.copy("frontdesk", "username", item())).toBe(true);
    expect(platformUtilsService.copyToClipboard).toHaveBeenCalledWith("frontdesk");
  });
});
