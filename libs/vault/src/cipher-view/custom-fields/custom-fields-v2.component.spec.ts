import { SimpleChanges } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import {
  TEMPLATE_FIELD_NAME,
  templateFields,
  BUILT_IN_TEMPLATES,
} from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { ToastService } from "@bitwarden/components";

import { CustomFieldV2Component } from "./custom-fields-v2.component";

describe("CustomFieldV2Component", () => {
  let component: CustomFieldV2Component;
  let fixture: ComponentFixture<CustomFieldV2Component>;

  const currentCipher = new CipherView();
  currentCipher.type = CipherType.Login;
  const premium$ = new BehaviorSubject(true);

  beforeEach(async () => {
    premium$.next(true);
    await TestBed.configureTestingModule({
      imports: [],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: EventCollectionService, useValue: mock<EventCollectionService>() },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "ana" }) } },
        {
          provide: BillingAccountProfileStateService,
          useValue: { hasPremiumFromAnySource$: () => premium$ },
        },
        {
          provide: TotpService,
          useValue: { getCode$: () => of({ code: "123456", period: 30 }) },
        },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomFieldV2Component);
    component = fixture.componentInstance;
    component.cipher = currentCipher;
    fixture.detectChanges();
  });

  it("updates fieldOptions on cipher change", () => {
    component.ngOnChanges({
      cipher: {
        currentValue: currentCipher,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      },
    } as SimpleChanges);

    expect(component.fieldOptions).toEqual(LoginView.prototype.linkedFieldOptions);

    const newCipher = new CipherView();
    newCipher.type = CipherType.Identity;

    component.cipher = newCipher;
    component.ngOnChanges({
      cipher: {
        currentValue: newCipher,
        previousValue: currentCipher,
        firstChange: false,
        isFirstChange: () => false,
      },
    } as SimpleChanges);
    fixture.detectChanges();

    expect(component.fieldOptions).toEqual(IdentityView.prototype.linkedFieldOptions);
  });

  // Keykeeper: a template's one-time code field (DESIGN.md, "In the editors").
  describe("a one-time code field from a template", () => {
    const withCode = (viewPassword = true) => {
      const item = new CipherView();
      item.type = CipherType.SecureNote;
      item.viewPassword = viewPassword;
      const fields = templateFields({
        id: "vendor",
        name: "Vendor console",
        icon: "bwi-file-text",
        base: "note",
        fields: [{ label: "Console code", kind: "totp" }],
      });
      fields[0].value = "JBSWY3DPEHPK3PXP";
      item.fields = fields;
      return item;
    };
    const render = (item: CipherView) => {
      component.cipher = item;
      component.ngOnChanges({
        cipher: {
          currentValue: item,
          previousValue: currentCipher,
          firstChange: false,
          isFirstChange: () => false,
        },
      } as SimpleChanges);
      fixture.detectChanges();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };
    const code = (el: HTMLElement) =>
      el.querySelector<HTMLInputElement>('[data-testid="keykeeper-field-code"]');

    it("shows the current code, with Copy, in place of the key", () => {
      const el = render(withCode());

      expect(code(el)?.value).toBe("123 456");
      expect(el.querySelector('[data-testid="keykeeper-copy-field-code"]')).not.toBeNull();
      expect(el.textContent).not.toContain("JBSWY3DPEHPK3PXP");
      expect([...el.querySelectorAll("input")].some((i) => i.value === "JBSWY3DPEHPK3PXP")).toBe(
        false,
      );
    });

    it("shows no code to someone who can't see the item's passwords", () => {
      const el = render(withCode(false));

      expect(code(el)?.value).toBe("*** ***");
      expect(el.querySelector('[data-testid="keykeeper-copy-field-code"]')).toBeNull();
    });

    it("says codes need Premium without it", () => {
      premium$.next(false);
      const el = render(withCode());

      expect(code(el)?.value).toBe("*** ***");
      expect(el.querySelector('[data-testid="keykeeper-field-code-needs-premium"]')).not.toBeNull();
    });

    it("is an ordinary hidden field on an item from no template", () => {
      const item = withCode();
      item.fields = item.fields.filter((f) => f.name !== TEMPLATE_FIELD_NAME);
      const el = render(item);

      expect(code(el)).toBeNull();
      expect(el.querySelector('input[type="password"]')).not.toBeNull();
    });

    it("leaves a built-in template's text fields as text", () => {
      const item = new CipherView();
      item.type = CipherType.SecureNote;
      item.viewPassword = true;
      item.fields = templateFields(BUILT_IN_TEMPLATES.find((t) => t.id === "api-key")!);
      item.fields.push(Object.assign(new FieldView(), { name: "Note", type: FieldType.Text }));
      const el = render(item);

      expect(code(el)).toBeNull();
    });
  });
});
