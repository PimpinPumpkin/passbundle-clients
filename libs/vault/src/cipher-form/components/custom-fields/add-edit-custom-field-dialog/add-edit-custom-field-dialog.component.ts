// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, Inject } from "@angular/core";
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from "@angular/forms";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { isReservedFieldName } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import {
  FIELD_KIND_NAMES,
  storedFieldType,
  TemplateFieldKind,
} from "@bitwarden/common/vault/keykeeper/templates";
import {
  DIALOG_DATA,
  AsyncActionsModule,
  ButtonModule,
  CheckboxModule,
  DialogModule,
  FormFieldModule,
  IconButtonModule,
  SelectModule,
} from "@bitwarden/components";

export type AddEditCustomFieldDialogData = {
  /** Keykeeper: a template's field can have a kind of its own, and be the expiration date. */
  addField: (type: FieldType, label: string, kind?: TemplateFieldKind, expires?: boolean) => void;
  updateLabel: (index: number, label: string, kind?: TemplateFieldKind, expires?: boolean) => void;
  removeField: (index: number) => void;
  /** Type of cipher */
  cipherType: CipherType;
  /** When provided, dialog will display edit label variants */
  editLabelConfig?: { index: number; label: string };
  disallowHiddenField?: boolean;
  /**
   * Keykeeper: the item is a custom template, whose fields have kinds: a
   * date, a website, an email address, a phone number, a number, or a
   * one-time code, besides upstream's (DESIGN.md, "Typed fields").
   */
  template?: boolean;
  /** Keykeeper: for a template's field being edited, its kind now. */
  editKind?: { kind: TemplateFieldKind; expires: boolean };
};

/** Keykeeper: the kinds a template's field can have, in the order they're offered. */
const TEMPLATE_KINDS: readonly TemplateFieldKind[] = [
  "text",
  "hidden",
  "boolean",
  "date",
  "url",
  "email",
  "phone",
  "number",
  "totp",
];

/** Keykeeper: what each of a template's own kinds does, under the picker. */
const KIND_HINTS: Partial<Record<TemplateFieldKind, string>> = {
  date: "A date picker. One date can be when new items expire.",
  url: "Checked as it's typed, without stopping a save.",
  email: "Checked as it's typed, without stopping a save.",
  phone: "Checked as it's typed, without stopping a save.",
  number: "Checked as it's typed, without stopping a save.",
  totp: "A one-time code's key, kept hidden. The item shows its current code.",
};

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "vault-add-edit-custom-field-dialog",
  templateUrl: "./add-edit-custom-field-dialog.component.html",
  imports: [
    CommonModule,
    JslibModule,
    DialogModule,
    ButtonModule,
    FormFieldModule,
    SelectModule,
    ReactiveFormsModule,
    IconButtonModule,
    AsyncActionsModule,
    CheckboxModule,
  ],
})
export class AddEditCustomFieldDialogComponent {
  variant: "add" | "edit";

  customFieldForm = this.formBuilder.group({
    type: FieldType.Text,
    // Keykeeper: never one of Keykeeper's own names, as a new field or a rename.
    label: ["", [Validators.required, (control: AbstractControl) => this.reservedName(control)]],
  });

  /** Keykeeper: names starting with "keykeeper." are Keykeeper's own data. */
  private reservedName(control: AbstractControl): ValidationErrors | null {
    return isReservedFieldName(control.value)
      ? { keykeeperReservedName: { message: this.i18nService.t("keykeeperReservedFieldName") } }
      : null;
  }

  fieldTypeOptions = [
    { name: this.i18nService.t("cfTypeText"), value: FieldType.Text },
    { name: this.i18nService.t("cfTypeHidden"), value: FieldType.Hidden },
    { name: this.i18nService.t("cfTypeCheckbox"), value: FieldType.Boolean },
    { name: this.i18nService.t("cfTypeLinked"), value: FieldType.Linked },
  ];

  FieldType = FieldType;

  /** Keykeeper: a template's field's kind, and whether it's the expiration date. */
  kindForm = this.formBuilder.group({
    kind: "text" as TemplateFieldKind,
    expires: false,
  });

  /** Keykeeper: the kinds a template's field may have here. */
  kindOptions: { name: string; value: TemplateFieldKind }[] = [];

  /** Keykeeper: whether the item is a custom template. */
  get isTemplate(): boolean {
    return this.data.template === true;
  }

  constructor(
    @Inject(DIALOG_DATA) private data: AddEditCustomFieldDialogData,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
  ) {
    this.variant = data.editLabelConfig ? "edit" : "add";

    this.fieldTypeOptions = this.fieldTypeOptions.filter((option) => {
      if (this.data.disallowHiddenField && option.value === FieldType.Hidden) {
        return false;
      }
      const omitLinkedFieldTypeForCiphers: number[] = [
        CipherType.SecureNote,
        CipherType.SshKey,
        CipherType.BankAccount,
        CipherType.DriversLicense,
        CipherType.Passport,
      ];
      if (omitLinkedFieldTypeForCiphers.includes(this.data.cipherType)) {
        return option.value !== FieldType.Linked;
      }

      return true;
    });

    if (this.variant === "edit") {
      this.customFieldForm.controls.label.setValue(data.editLabelConfig.label);
      this.customFieldForm.controls.type.disable();
    }

    // Keykeeper: a template's kinds. A field being edited keeps how it's
    // stored (text, hidden, or a checkbox), so only kinds stored the same way.
    if (this.isTemplate) {
      const current = data.editKind?.kind;
      this.kindOptions = TEMPLATE_KINDS.filter((kind) => {
        if (current != null) {
          return storedFieldType(kind) === storedFieldType(current);
        }
        return !(this.data.disallowHiddenField && storedFieldType(kind) === FieldType.Hidden);
      }).map((kind) => ({ name: FIELD_KIND_NAMES[kind], value: kind }));
      this.kindForm.setValue({
        kind: current ?? "text",
        expires: data.editKind?.expires ?? false,
      });
    }
  }

  getTypeHint(): string {
    // Keykeeper: a template's own kinds.
    if (this.isTemplate) {
      const kind = this.kindForm.value.kind;
      const own = KIND_HINTS[kind];
      if (own != null) {
        return own;
      }
      return this.typeHint(storedFieldType(kind));
    }
    return this.typeHint(this.customFieldForm.get("type")?.value);
  }

  private typeHint(type: FieldType): string {
    switch (type) {
      case FieldType.Text:
        return this.i18nService.t("textHelpText");
      case FieldType.Hidden:
        return this.i18nService.t("hiddenHelpText");
      case FieldType.Boolean:
        return this.i18nService.t("checkBoxHelpText");
      case FieldType.Linked:
        return this.i18nService.t("linkedHelpText");
      default:
        return "";
    }
  }

  /** Direct the form submission to the proper action */
  submit = () => {
    if (this.variant === "add") {
      this.addField();
    } else {
      this.updateLabel();
    }
  };

  /** Invoke the `addField` callback with the custom field details */
  addField() {
    if (this.customFieldForm.invalid) {
      return;
    }

    const { type, label } = this.customFieldForm.value;
    const { kind, expires } = this.kindForm.value;
    if (this.isTemplate) {
      this.data.addField(storedFieldType(kind), label, kind, kind === "date" && expires);
      return;
    }
    this.data.addField(type, label);
  }

  /** Invoke the `updateLabel` callback with the new label */
  updateLabel() {
    if (this.customFieldForm.invalid) {
      return;
    }

    const { label } = this.customFieldForm.value;
    const { kind, expires } = this.kindForm.value;
    if (this.isTemplate) {
      this.data.updateLabel(
        this.data.editLabelConfig.index,
        label,
        kind,
        kind === "date" && expires,
      );
      return;
    }
    this.data.updateLabel(this.data.editLabelConfig.index, label);
  }

  /** Invoke the `removeField` callback */
  removeField() {
    this.data.removeField(this.data.editLabelConfig.index);
  }
}
