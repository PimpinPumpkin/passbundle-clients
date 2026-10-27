import { CommonModule } from "@angular/common";
import { Component, Input, OnChanges, OnInit, SimpleChanges } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { EventCollectionService, EventType } from "@bitwarden/common/dirt/event-logs";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType, LinkedIdType } from "@bitwarden/common/vault/enums";
import { HIDDEN_VALUE_MASK } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
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

import { VaultAutosizeReadOnlyTextArea } from "../../directives/readonly-textarea.directive";
import { visibleCustomFields } from "../../keykeeper/reserved-fields";

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
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["cipher"]) {
      this.revealedHiddenFields = [];
      this.fieldOptions = this.getLinkedFieldsOptionsForCipher();
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
