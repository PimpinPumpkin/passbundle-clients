import { CommonModule } from "@angular/common";
import { Component, inject, Input, OnChanges, OnInit, signal, SimpleChanges } from "@angular/core";
import { Observable, switchMap } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { EventCollectionService, EventType } from "@bitwarden/common/dirt/event-logs";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType, LinkedIdType } from "@bitwarden/common/vault/enums";
import { HIDDEN_VALUE_MASK } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import {
  FieldTyping,
  fieldKind,
  itemTyping,
  TemplateFieldKind,
} from "@bitwarden/common/vault/keykeeper/templates";
import { showsTwoStepCode } from "@bitwarden/common/vault/keykeeper/two-step-codes";
import { LinkedMetadata } from "@bitwarden/common/vault/linked-field-option.decorator";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import {
  CardComponent,
  IconButtonModule,
  FormFieldModule,
  InputModule,
  SectionHeaderComponent,
  TypographyModule,
  CheckboxModule,
  ColorPasswordModule,
} from "@bitwarden/components";

import { BitTotpCountdownComponent } from "../../components/totp-countdown/totp-countdown.component";
import { VaultAutosizeReadOnlyTextArea } from "../../directives/readonly-textarea.directive";
import { visibleCustomFields } from "../../keykeeper/reserved-fields";

/** Keykeeper: a one-time code field's current code, as login codes have theirs. */
type FieldCode = { totpCode: string; totpCodeFormatted?: string };

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-custom-fields-v2",
  templateUrl: "custom-fields-v2.component.html",
  imports: [
    CommonModule,
    JslibModule,
    CardComponent,
    IconButtonModule,
    FormFieldModule,
    InputModule,
    SectionHeaderComponent,
    TypographyModule,
    CheckboxModule,
    ColorPasswordModule,
    VaultAutosizeReadOnlyTextArea,
    BitTotpCountdownComponent,
  ],
})
export class CustomFieldV2Component implements OnInit, OnChanges {
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input({ required: true }) cipher!: CipherView;
  fieldType = FieldType;
  fieldOptions: Map<number, LinkedMetadata> | undefined;

  /** Keykeeper: the custom fields to show, without Keykeeper's own fields. */
  get visibleFields() {
    return visibleCustomFields(this.cipher.fields);
  }

  /** Keykeeper: the kinds of the item's fields, from its template (DESIGN.md, "Typed fields"). */
  private typing: FieldTyping = { types: {} };

  /**
   * Keykeeper: one-time code fields' current codes, by the field's place. A
   * signal, since the countdown sends each code while the view is drawn.
   */
  protected readonly codes = signal<ReadonlyMap<number, FieldCode>>(new Map());
  private readonly codeItems = new Map<string, CipherView>();

  private readonly billingAccountProfileStateService = inject(BillingAccountProfileStateService);

  /** Keykeeper: whether the person has Premium, which two-step codes need (two-step-codes.ts). */
  protected readonly isPremium$: Observable<boolean> = inject(AccountService).activeAccount$.pipe(
    getUserId,
    switchMap((userId) => this.billingAccountProfileStateService.hasPremiumFromAnySource$(userId)),
  );

  /** Keykeeper: a field's kind: its template's, else its own type's. */
  kindOf(field: FieldView): TemplateFieldKind | null {
    return fieldKind(field, this.typing);
  }

  /** Keykeeper: whether a one-time code field's code shows: with Premium, or an organization that gives codes. */
  codeShows(isPremium: boolean | null): boolean {
    return showsTwoStepCode(this.cipher, isPremium === true);
  }

  /**
   * Keykeeper: the countdown reads a login's key, so a one-time code field's
   * key goes to it as one, the same object for the same key.
   */
  codeItem(key: string): CipherView {
    let item = this.codeItems.get(key);
    if (item == null) {
      item = { login: { totp: key } } as CipherView;
      this.codeItems.set(key, item);
    }
    return item;
  }

  setCode(index: number, code: FieldCode) {
    // Never for someone who can't see the item's passwords.
    if (this.canViewPassword) {
      this.codes.update((codes) => new Map(codes).set(index, code));
    }
  }

  /** Indexes of hidden fields that are revealed */
  revealedHiddenFields: number[] = [];

  /**
   * Indicates whether the hidden field's character count should be shown
   */
  showHiddenValueCountFields: number[] = [];

  constructor(
    private i18nService: I18nService,
    private eventCollectionService: EventCollectionService,
  ) {}

  ngOnInit(): void {
    this.fieldOptions = this.getLinkedFieldsOptionsForCipher();
    this.typing = itemTyping(this.cipher);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["cipher"]) {
      this.revealedHiddenFields = [];
      this.fieldOptions = this.getLinkedFieldsOptionsForCipher();
      this.typing = itemTyping(this.cipher);
      this.codes.set(new Map());
      this.codeItems.clear();
    }
  }

  getLinkedType(linkedId: LinkedIdType) {
    const linkedType = this.fieldOptions?.get(linkedId);

    return linkedType ? this.i18nService.t(linkedType.i18nKey) : null;
  }

  get canViewPassword() {
    return this.cipher.viewPassword;
  }

  /** Keykeeper: shown in place of a hidden field's value the person can't see. */
  protected readonly mask = HIDDEN_VALUE_MASK;

  emptyFieldAriaLabel(field: FieldView): string | null {
    if (field.value) {
      return null;
    }
    return `${field.name}, ${this.i18nService.t("noValueEntered")}`;
  }

  toggleCharacterCount(index: number) {
    const fieldIndex = this.showHiddenValueCountFields.indexOf(index);
    if (fieldIndex > -1) {
      this.showHiddenValueCountFields.splice(fieldIndex, 1);
    } else {
      this.showHiddenValueCountFields.push(index);
    }
  }

  async toggleHiddenField(hiddenFieldVisible: boolean, index: number) {
    // Keykeeper: never shown to someone who can't see the item's passwords.
    if (hiddenFieldVisible && !this.canViewPassword) {
      return;
    }
    if (hiddenFieldVisible) {
      this.revealedHiddenFields.push(index);
    } else {
      this.revealedHiddenFields = this.revealedHiddenFields.filter((i) => i !== index);
    }

    if (hiddenFieldVisible) {
      await this.eventCollectionService.collect(
        EventType.Cipher_ClientToggledHiddenFieldVisible,
        this.cipher.id,
        false,
        this.cipher.organizationId,
      );
    }
  }

  async logCopyEvent() {
    await this.eventCollectionService.collect(
      EventType.Cipher_ClientCopiedHiddenField,
      this.cipher.id,
      false,
      this.cipher.organizationId,
    );
  }

  private getLinkedFieldsOptionsForCipher() {
    switch (this.cipher.type) {
      case CipherType.Login:
        return LoginView.prototype.linkedFieldOptions;
      case CipherType.Card:
        return CardView.prototype.linkedFieldOptions;
      case CipherType.Identity:
        return IdentityView.prototype.linkedFieldOptions;
      default:
        return undefined;
    }
  }
}
