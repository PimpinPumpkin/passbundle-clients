// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { LiveAnnouncer } from "@angular/cdk/a11y";
import { CdkDragDrop, DragDropModule, moveItemInArray } from "@angular/cdk/drag-drop";
import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
  QueryList,
  ViewChildren,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
} from "@angular/forms";
import { Subject, zip } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { EventCollectionService, EventType } from "@bitwarden/common/dirt/event-logs";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType, LinkedIdType } from "@bitwarden/common/vault/enums";
import {
  isSecretLinkedField,
  maySeeSecretsOrNew,
} from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { isReservedFieldName } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import {
  FIELD_KIND_NAMES,
  fieldKind,
  itemTyping,
  storedFieldType,
  TEMPLATE_DEFINITION_FIELD_NAME,
  TEMPLATE_FIELD_NAME,
  TemplateField,
  TemplateFieldKind,
  templateDefinition,
  typedFieldProblem,
  TypedKind,
  typingOfFields,
  withTyping,
} from "@bitwarden/common/vault/keykeeper/templates";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import {
  DialogRef,
  CardComponent,
  CheckboxModule,
  DialogService,
  FormFieldModule,
  IconButtonModule,
  LinkModule,
  InputTypes,
  SectionHeaderComponent,
  SelectModule,
  TypographyModule,
} from "@bitwarden/components";

import { KeykeeperExpiresLink } from "../../../keykeeper/expires-link";
import { keykeeperFields, visibleCustomFields } from "../../../keykeeper/reserved-fields";
import { CipherFormContainer } from "../../cipher-form-container";

import {
  AddEditCustomFieldDialogComponent,
  AddEditCustomFieldDialogData,
} from "./add-edit-custom-field-dialog/add-edit-custom-field-dialog.component";

/** Attributes associated with each individual FormGroup within the FormArray */
export type CustomField = {
  type: FieldType;
  name: string;
  value: string | boolean | null;
  linkedId: LinkedIdType;
  /**
   * `newField` is set to true when the custom field is created.
   *
   * This is applicable when the user is adding a new field but
   * the `viewPassword` property on the cipher is false. The
   * user will still need the ability to set the value of the field
   * they just created.
   *
   * See {@link CustomFieldsComponent.canViewPasswords} for implementation.
   */
  newField: boolean;
};

/**
 * Keykeeper: a field's kind from its template, beyond upstream's own (a date,
 * a website, and so on), and whether it's the item's expiration date. Kept
 * beside the field's row, so it moves when the row does.
 */
type Typed = { kind: TypedKind; expires: boolean };

const isTyped = (kind: TemplateFieldKind | null | undefined): kind is TypedKind =>
  kind != null && kind !== "text" && kind !== "hidden" && kind !== "boolean";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "vault-custom-fields",
  templateUrl: "./custom-fields.component.html",
  imports: [
    JslibModule,
    CommonModule,
    FormsModule,
    FormFieldModule,
    ReactiveFormsModule,
    SectionHeaderComponent,
    TypographyModule,
    CardComponent,
    IconButtonModule,
    CheckboxModule,
    SelectModule,
    DragDropModule,
    LinkModule,
  ],
})
export class CustomFieldsComponent implements OnInit, AfterViewInit {
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-output-emitter-ref
  @Output() numberOfFieldsChange = new EventEmitter<number>();

  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @ViewChildren("customFieldRow") customFieldRows: QueryList<ElementRef<HTMLDivElement>>;

  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() disableSectionMargin: boolean;

  customFieldsForm = this.formBuilder.group({
    fields: new FormArray([]),
  });

  /** Reference to the add field dialog */
  dialogRef: DialogRef;

  /**
   * Options for Linked Fields. Keykeeper: someone who can't see the item's
   * passwords can't link a field to a secret (the password, a card's number
   * or code, an SSN, or a passport or license number), which filling would
   * put into a page they can read.
   */
  linkedFieldOptions: { name: string; value: LinkedIdType; secret: boolean }[] = [];

  /** True when edit/reorder toggles should be hidden based on partial-edit */
  isPartialEdit: boolean;

  /** True when there are custom fields available */
  hasCustomFields = false;

  /** Emits when a new custom field should be focused */
  private focusOnNewInput$ = new Subject<void>();

  /** Tracks the disabled status of the edit cipher form */
  protected parentFormDisabled: boolean = false;

  disallowHiddenField?: boolean;

  destroyed$: DestroyRef;
  FieldType = FieldType;

  /** Keykeeper: each typed field's kind (DESIGN.md, "Item templates", "Typed fields"). */
  private readonly typed = new WeakMap<AbstractControl, Typed>();

  /**
   * Keykeeper: where the item keeps its fields' kinds: its own definition,
   * for a custom template; the marker of the template it came from; or
   * nowhere, for an item from no template.
   */
  protected carrier: "definition" | "marker" | null = null;

  /** Keykeeper: "Expires", for a template's expiration date field to follow. */
  private readonly expiresLink = inject(KeykeeperExpiresLink, { optional: true });
  private linkedDateSent: string | null = null;
  /** Keykeeper: the fields are in place, so a change is the person's. */
  private ready = false;

  constructor(
    private dialogService: DialogService,
    private cipherFormContainer: CipherFormContainer,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
    private liveAnnouncer: LiveAnnouncer,
    private eventCollectionService: EventCollectionService,
  ) {
    this.destroyed$ = inject(DestroyRef);
    this.cipherFormContainer.registerChildForm("customFields", this.customFieldsForm);

    this.customFieldsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      // getRawValue ensures disabled fields are included
      this.updateCipher(this.fields.getRawValue());
      this.sendLinkedDate();
    });

    // Keykeeper: "Expires" changed, so the template's expiration date follows.
    this.expiresLink?.fromExpires$.pipe(takeUntilDestroyed()).subscribe((date) => {
      const control = this.linkedControl();
      if (control != null && control.enabled && (control.getRawValue().value ?? "") !== date) {
        control.patchValue({ value: date });
      }
    });

    this.cipherFormContainer.formStatusChange$.pipe(takeUntilDestroyed()).subscribe((status) => {
      this.parentFormDisabled = status === "disabled";
    });
  }

  /** Fields form array, referenced via a getter to avoid type-casting in multiple places  */
  get fields(): FormArray {
    return this.customFieldsForm.controls.fields as FormArray;
  }

  canEdit(type: FieldType): boolean {
    return !this.isPartialEdit && (type !== FieldType.Hidden || !this.hidesSecrets);
  }

  /** Keykeeper: whether this is an existing item whose secrets the person can't see. */
  private get hidesSecrets(): boolean {
    return !maySeeSecretsOrNew(this.cipherFormContainer.originalCipherView);
  }

  dragDisabled(type: FieldType): boolean {
    return !this.canEdit(type) || this.fields.length <= 1;
  }

  ngOnInit() {
    this.ready = false;
    const linkedFieldsOptionsForCipher = this.getLinkedFieldsOptionsForCipher();
    const optionsArray = Array.from(linkedFieldsOptionsForCipher?.entries() ?? []);
    optionsArray.sort((a, b) => a[1].sortPosition - b[1].sortPosition);

    // Populate options for linked custom fields
    const cipherType = this.cipherFormContainer.config.cipherType;
    this.linkedFieldOptions = optionsArray.map(([id, linkedFieldOption]) => ({
      name: this.i18nService.t(linkedFieldOption.i18nKey),
      value: id as LinkedIdType,
      secret:
        this.hidesSecrets &&
        isSecretLinkedField(
          { type: cipherType, linkedFieldOptions: linkedFieldsOptionsForCipher },
          id as LinkedIdType,
        ),
    }));

    const prefillCipher = this.cipherFormContainer.getInitialCipherView();

    // Keykeeper: its own fields are not shown here (see updateCipher).
    // When available, populate the form with the existing fields
    // Keykeeper: a new item can start with fields, for example from a template.
    const prefillFields =
      prefillCipher?.fields ?? this.cipherFormContainer.config.initialValues?.fields;
    // Keykeeper: each field's kind, from the template's definition or the
    // marker of the template the item came from.
    this.carrier =
      templateDefinition({ fields: prefillFields }) != null
        ? "definition"
        : (prefillFields ?? []).some((f) => f.name === TEMPLATE_FIELD_NAME)
          ? "marker"
          : null;
    const typing = itemTyping({ fields: prefillFields });
    visibleCustomFields(prefillFields).forEach((field) => {
      let value: string | boolean = field.value;

      if (field.type === FieldType.Boolean) {
        value = field.value === "true" ? true : false;
      }

      const customField = this.formBuilder.group<CustomField>({
        type: field.type,
        name: field.name,
        value: value,
        linkedId: field.linkedId,
        newField: false,
      });

      // Keykeeper: only lock hidden fields of an existing item the person may not
      // view. A new item (from a template, say) has no original and is theirs.
      if (field.type === FieldType.Hidden && this.hidesSecrets) {
        customField.controls.value.disable();
      }

      const kind = fieldKind(field, typing);
      if (isTyped(kind)) {
        this.typed.set(customField, {
          kind,
          expires: kind === "date" && typing.expires === field.name,
        });
      }

      this.fields.push(customField);
    });
    this.linkedDateSent = this.linkedDate();

    // Disable the form if in partial-edit mode
    // Must happen after the initial fields are populated
    if (this.cipherFormContainer.config.mode === "partial-edit") {
      this.isPartialEdit = true;
      this.customFieldsForm.disable();
    }
    this.ready = true;
  }

  ngAfterViewInit(): void {
    // Focus on the new input field when it is added
    // This is done after the view is initialized to ensure the input is rendered
    zip(this.focusOnNewInput$, this.customFieldRows.changes)
      .pipe(takeUntilDestroyed(this.destroyed$))
      .subscribe(() => {
        const mostRecentRow = this.customFieldRows.last.nativeElement;
        const input = mostRecentRow.querySelector<HTMLInputElement>("input");
        const label = mostRecentRow.querySelector<HTMLLabelElement>("label").textContent.trim();

        // Focus the input after the announcement element is added to the DOM,
        // this should stop the announcement from being cut off by the "focus" event.
        void this.liveAnnouncer
          .announce(this.i18nService.t("fieldAdded", label), "polite")
          .then(() => {
            input.focus();
          });
      });
  }

  /** Opens the add/edit custom field dialog */
  openAddEditCustomFieldDialog(editLabelConfig?: AddEditCustomFieldDialogData["editLabelConfig"]) {
    const { cipherType, mode, originalCipher } = this.cipherFormContainer.config;
    const editing = editLabelConfig ? this.fields.at(editLabelConfig.index) : null;
    this.dialogRef = this.dialogService.open<unknown, AddEditCustomFieldDialogData>(
      AddEditCustomFieldDialogComponent,
      {
        data: {
          addField: this.addField.bind(this),
          updateLabel: this.updateLabel.bind(this),
          removeField: this.removeField.bind(this),
          cipherType,
          editLabelConfig,
          // Keykeeper: whatever the mode, for an item whose secrets the person can't see.
          disallowHiddenField: mode !== "add" && !maySeeSecretsOrNew(originalCipher),
          // Keykeeper: a template's fields have kinds (DESIGN.md, "Typed fields").
          template: this.carrier === "definition",
          editKind: editing
            ? { kind: this.kindOf(editing), expires: this.typed.get(editing)?.expires ?? false }
            : undefined,
        },
      },
    );
  }

  /** Returns true when the user has permission to view passwords for the individual cipher */
  canViewPasswords(index: number) {
    return !this.hidesSecrets || this.fields.at(index).value.newField;
  }

  /**
   * Updates label for an individual field. Keykeeper: and a template's
   * field's kind, among those kept the same way.
   */
  updateLabel(index: number, label: string, kind?: TemplateFieldKind, expires?: boolean) {
    // Keykeeper: never one of Keykeeper's own names (the dialog says so too).
    if (isReservedFieldName(label)) {
      return;
    }
    const control = this.fields.at(index);
    if (kind != null && storedFieldType(kind) === control.value.type) {
      this.setKind(control, kind, expires === true);
    }
    control.patchValue({ name: label });
    void this.dialogRef?.close();
  }

  /** Removes an individual field at a specific index */
  removeField(index: number) {
    this.fields.removeAt(index);
    void this.dialogRef?.close();
  }

  /** Adds a new field to the form. Keykeeper: a template's can have a kind of its own. */
  addField(type: FieldType, label: string, kind?: TemplateFieldKind, expires?: boolean) {
    // Keykeeper: never one of Keykeeper's own names (the dialog says so too).
    if (isReservedFieldName(label)) {
      return;
    }
    void this.dialogRef?.close();

    let value = null;
    let linkedId = null;

    if (type === FieldType.Boolean) {
      // Default to false for boolean fields
      value = false;
    }

    if (type === FieldType.Linked && this.linkedFieldOptions.length > 0) {
      // Default to the first linked field option. Keykeeper: one the person may link to.
      linkedId = this.linkedFieldOptions.find((option) => !option.secret)?.value ?? null;
    }

    const group = this.formBuilder.group<CustomField>({
      type,
      name: label,
      value,
      linkedId,
      newField: true,
    });
    if (kind != null && storedFieldType(kind) === type) {
      this.setKind(group, kind, expires === true);
    }
    this.fields.push(group);

    // Trigger focus on the new input field
    this.focusOnNewInput$.next();
  }

  /** Reorder the controls to match the new order after a "drop" event */
  drop(event: CdkDragDrop<HTMLDivElement>) {
    // Alter the order of the fields array in place
    moveItemInArray(this.fields.controls, event.previousIndex, event.currentIndex);

    this.updateCipher(this.fields.controls.map((control) => control.value));
  }

  /** Move a custom field up or down in the list order */
  async handleKeyDown(event: KeyboardEvent, label: string, index: number) {
    if (event.key === "ArrowUp" && index !== 0) {
      event.preventDefault();

      const currentIndex = index - 1;
      this.drop({ previousIndex: index, currentIndex } as CdkDragDrop<HTMLDivElement>);
      await this.liveAnnouncer.announce(
        this.i18nService.t("reorderFieldUp", label, currentIndex + 1, this.fields.length),
        "assertive",
      );

      // Refocus the button after the reorder
      // Angular re-renders the list when moving an item up which causes the focus to be lost
      // Wait for the next tick to ensure the button is rendered before focusing
      setTimeout(() => {
        (event.target as HTMLButtonElement).focus();
      });
    }

    if (event.key === "ArrowDown" && index !== this.fields.length - 1) {
      event.preventDefault();

      const currentIndex = index + 1;
      this.drop({ previousIndex: index, currentIndex } as CdkDragDrop<HTMLDivElement>);
      await this.liveAnnouncer.announce(
        this.i18nService.t("reorderFieldDown", label, currentIndex + 1, this.fields.length),
        "assertive",
      );
    }
  }

  async logHiddenEvent(hiddenFieldVisible: boolean) {
    const { mode, originalCipher } = this.cipherFormContainer.config;

    const isEdit = ["edit", "partial-edit"].includes(mode);

    if (hiddenFieldVisible && isEdit) {
      await this.eventCollectionService.collect(
        EventType.Cipher_ClientToggledHiddenFieldVisible,
        originalCipher.id,
        false,
        originalCipher.organizationId,
      );
    }
  }

  /**
   * Returns the linked field options for the current cipher type
   *
   * Note: Note ciphers do not have linked fields
   */
  private getLinkedFieldsOptionsForCipher() {
    switch (this.cipherFormContainer.config.cipherType) {
      case CipherType.Login:
        return LoginView.prototype.linkedFieldOptions;
      case CipherType.Card:
        return CardView.prototype.linkedFieldOptions;
      case CipherType.Identity:
        return IdentityView.prototype.linkedFieldOptions;
      default:
        return null;
    }
  }

  /** Keykeeper: a field's kind: its template's, else its own type's. */
  protected kindOf(control: AbstractControl): TemplateFieldKind {
    const typed = this.typed.get(control);
    if (typed != null) {
      return typed.kind;
    }
    const type = control.value.type as FieldType;
    return type === FieldType.Hidden ? "hidden" : type === FieldType.Boolean ? "boolean" : "text";
  }

  /** Keykeeper: the input for a typed text field: a date picker for a date. */
  protected inputType(control: AbstractControl): InputTypes {
    switch (this.kindOf(control)) {
      case "date":
        return "date";
      case "email":
        return "email";
      default:
        return "text";
    }
  }

  /** Keykeeper: the keyboard a typed text field gets on a phone or tablet. */
  protected inputMode(control: AbstractControl): string | null {
    switch (this.kindOf(control)) {
      case "url":
        return "url";
      case "email":
        return "email";
      case "phone":
        return "tel";
      case "number":
        return "decimal";
      default:
        return null;
    }
  }

  /** Keykeeper: what's wrong with a typed field's value; it never stops a save. */
  protected problem(control: AbstractControl): string | null {
    return typedFieldProblem(this.kindOf(control), control.getRawValue().value as string);
  }

  /** Keykeeper: under a typed field, what it is. */
  protected kindNote(control: AbstractControl): string | null {
    const typed = this.typed.get(control);
    if (typed == null) {
      return null;
    }
    if (this.carrier === "definition") {
      const name = FIELD_KIND_NAMES[typed.kind];
      return typed.expires ? `${name}. New items expire on this date.` : `${name}.`;
    }
    if (typed.expires) {
      return "Also when this item expires.";
    }
    return typed.kind === "totp" ? "A one-time code's key. The item shows its current code." : null;
  }

  /** Keykeeper: gives a field a kind; one date at most is the expiration date. */
  private setKind(control: AbstractControl, kind: TemplateFieldKind, expires: boolean) {
    if (!isTyped(kind)) {
      this.typed.delete(control);
      return;
    }
    const isExpiration = kind === "date" && expires;
    if (isExpiration) {
      for (const other of this.fields.controls) {
        const typed = this.typed.get(other);
        if (typed?.expires) {
          this.typed.set(other, { ...typed, expires: false });
        }
      }
    }
    this.typed.set(control, { kind, expires: isExpiration });
  }

  /**
   * Keykeeper: the field that is an item's expiration date, as its template
   * marks it. A template's own is a default for new items, so it has none.
   */
  private linkedControl(): AbstractControl | null {
    if (this.carrier !== "marker") {
      return null;
    }
    return (
      this.fields.controls.find(
        (c) => this.typed.get(c)?.expires === true && c.value.type === FieldType.Text,
      ) ?? null
    );
  }

  private linkedDate(): string | null {
    const control = this.linkedControl();
    return control == null ? null : ((control.getRawValue().value as string) ?? "").trim();
  }

  /** Keykeeper: the expiration date field changed, so "Expires" follows. */
  private sendLinkedDate() {
    const date = this.linkedDate();
    if (!this.ready || date === this.linkedDateSent) {
      return;
    }
    this.linkedDateSent = date;
    if (date != null) {
      this.expiresLink?.fieldChanged(date);
    }
  }

  /**
   * Keykeeper: the item's definition or marker with its fields' kinds as the
   * form has them now (a rename takes its kind along), its other contents as
   * they were.
   */
  private withKinds(ours: FieldView[]): FieldView[] {
    if (this.carrier == null) {
      return ours;
    }
    const name =
      this.carrier === "definition" ? TEMPLATE_DEFINITION_FIELD_NAME : TEMPLATE_FIELD_NAME;
    const typing = typingOfFields(
      this.fields.controls.flatMap((control): TemplateField[] => {
        const typed = this.typed.get(control);
        const label = control.getRawValue().name as string;
        if (typed == null) {
          return [];
        }
        return typed.expires
          ? [{ label, kind: typed.kind, expires: true }]
          : [{ label, kind: typed.kind }];
      }),
    );
    return ours.map((field) => {
      const value = field.name === name ? withTyping(field.value, typing) : null;
      if (value == null || value === field.value) {
        return field;
      }
      const updated = new FieldView();
      updated.name = field.name;
      updated.type = field.type;
      updated.value = value;
      updated.linkedId = field.linkedId;
      return updated;
    });
  }

  /** Create `FieldView` from the form objects and update the cipher */
  private updateCipher(fields: CustomField[]) {
    const newFields = fields.map((field: CustomField) => {
      let value: string;

      if (typeof field.value === "number") {
        value = `${field.value}`;
      } else if (typeof field.value === "boolean") {
        value = field.value ? "true" : "false";
      } else {
        value = field.value;
      }

      const fieldView = new FieldView();
      fieldView.type = field.type;
      fieldView.name = field.name;
      fieldView.value = value;
      fieldView.linkedId = field.linkedId ?? undefined;
      return fieldView;
    });

    this.hasCustomFields = newFields.length > 0;

    this.numberOfFieldsChange.emit(newFields.length);

    // Keykeeper: keep its own fields as they are on the item right now, which
    // another section (expiration, for example) may have just changed.
    // And the kinds of its fields, in its definition or its template's marker.
    this.cipherFormContainer.patchCipher((cipher) => {
      cipher.fields = [...newFields, ...this.withKinds(keykeeperFields(cipher.fields))];
      return cipher;
    });
  }
}
