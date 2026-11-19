import { ComponentFixture, TestBed } from "@angular/core/testing";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { DIALOG_DATA } from "@bitwarden/components";

import {
  AddEditCustomFieldDialogComponent,
  AddEditCustomFieldDialogData,
} from "./add-edit-custom-field-dialog.component";

describe("AddEditCustomFieldDialogComponent", () => {
  let component: AddEditCustomFieldDialogComponent;
  let fixture: ComponentFixture<AddEditCustomFieldDialogComponent>;
  const addField = jest.fn();
  const updateLabel = jest.fn();
  const removeField = jest.fn();

  const dialogData = {
    addField,
    updateLabel,
    removeField,
    cipherType: CipherType.Login,
  } as AddEditCustomFieldDialogData;

  beforeEach(async () => {
    addField.mockClear();
    updateLabel.mockClear();
    removeField.mockClear();

    await TestBed.configureTestingModule({
      imports: [AddEditCustomFieldDialogComponent],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: DIALOG_DATA, useValue: dialogData },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AddEditCustomFieldDialogComponent);
    component = fixture.componentInstance;
    // FIXME: Remove when updating file. Eslint update
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    fixture.detectChanges;
  });

  it("creates", () => {
    expect(component).toBeTruthy();
  });

  it("calls `addField` from DIALOG_DATA on with the type and label", () => {
    component.customFieldForm.setValue({ type: FieldType.Text, label: "Test Label" });

    component.submit();

    expect(addField).toHaveBeenCalledWith(FieldType.Text, "Test Label");
  });

  it("calls `updateLabel` from DIALOG_DATA with the new label", () => {
    component.variant = "edit";
    dialogData.editLabelConfig = { index: 0, label: "Test Label" };
    component.customFieldForm.setValue({ type: FieldType.Text, label: "Test Label 2" });

    component.submit();

    expect(updateLabel).toHaveBeenCalledWith(0, "Test Label 2");
  });

  it("Keykeeper: refuses Keykeeper's own names, for a new field or a rename", () => {
    for (const label of [
      "keykeeper.template-definition",
      "keykeeper.fill",
      " Keykeeper.anything ",
    ]) {
      component.customFieldForm.setValue({ type: FieldType.Text, label });
      expect(component.customFieldForm.controls.label.errors).toEqual({
        keykeeperReservedName: { message: "keykeeperReservedFieldName" },
      });

      component.variant = "add";
      component.submit();
      component.variant = "edit";
      dialogData.editLabelConfig = { index: 0, label: "Test Label" };
      component.submit();
    }
    expect(addField).not.toHaveBeenCalled();
    expect(updateLabel).not.toHaveBeenCalled();

    component.customFieldForm.setValue({ type: FieldType.Text, label: "Keykeeper notes" });
    expect(component.customFieldForm.valid).toBe(true);
  });

  it("calls `removeField` from DIALOG_DATA with the respective index", () => {
    dialogData.editLabelConfig = { index: 2, label: "Test Label" };

    component.removeField();

    expect(removeField).toHaveBeenCalledWith(2);
  });

  it.each([
    ["SecureNote", CipherType.SecureNote],
    ["SshKey", CipherType.SshKey],
    ["BankAccount", CipherType.BankAccount],
    ["DriversLicense", CipherType.DriversLicense],
    ["Passport", CipherType.Passport],
  ])('filters out "Linked" field type for %s cipher type', (_, cipherType) => {
    dialogData.cipherType = cipherType;

    fixture = TestBed.createComponent(AddEditCustomFieldDialogComponent);
    component = fixture.componentInstance;

    expect(component.fieldTypeOptions).not.toContainEqual(
      expect.objectContaining({ value: FieldType.Linked }),
    );
  });

  it("does not filter out 'Hidden' field type when 'disallowHiddenField' is false", () => {
    dialogData.disallowHiddenField = false;
    fixture = TestBed.createComponent(AddEditCustomFieldDialogComponent);
    component = fixture.componentInstance;

    expect(component.fieldTypeOptions).toContainEqual(
      expect.objectContaining({ value: FieldType.Hidden }),
    );
  });

  it("filers out 'Hidden' field type when 'disallowHiddenField' is true", () => {
    dialogData.disallowHiddenField = true;
    fixture = TestBed.createComponent(AddEditCustomFieldDialogComponent);
    component = fixture.componentInstance;

    expect(component.fieldTypeOptions).not.toContainEqual(
      expect.objectContaining({ value: FieldType.Hidden }),
    );
  });
});

// Keykeeper: a template's fields have kinds (DESIGN.md, "In the editors").
describe("AddEditCustomFieldDialogComponent for a template", () => {
  const addField = jest.fn();
  const updateLabel = jest.fn();

  async function open(data: Partial<AddEditCustomFieldDialogData>) {
    addField.mockClear();
    updateLabel.mockClear();
    await TestBed.configureTestingModule({
      imports: [AddEditCustomFieldDialogComponent],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: DIALOG_DATA,
          useValue: {
            addField,
            updateLabel,
            removeField: jest.fn(),
            cipherType: CipherType.SecureNote,
            template: true,
            ...data,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AddEditCustomFieldDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it("offers every kind, and adds a field with its kind and whether it's the expiration date", async () => {
    const fixture = await open({});
    const component = fixture.componentInstance;

    expect(component.kindOptions.map((o) => [o.value, o.name])).toEqual([
      ["text", "Text"],
      ["hidden", "Hidden"],
      ["boolean", "Checkbox"],
      ["date", "Date"],
      ["url", "Website"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["number", "Number"],
      ["totp", "One-time code"],
    ]);
    component.customFieldForm.patchValue({ label: "Renews" });
    component.kindForm.setValue({ kind: "date", expires: true });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="keykeeper-field-expires"]'),
    ).not.toBeNull();

    component.submit();

    expect(addField).toHaveBeenCalledWith(FieldType.Text, "Renews", "date", true);
  });

  it("keeps a one-time code's key in a hidden field, and only a date can be the expiration date", async () => {
    const component = (await open({})).componentInstance;
    component.customFieldForm.patchValue({ label: "Console code" });
    component.kindForm.setValue({ kind: "totp", expires: true });

    component.submit();

    expect(addField).toHaveBeenCalledWith(FieldType.Hidden, "Console code", "totp", false);
  });

  it("changes a field's kind only among those kept the same way", async () => {
    const component = (
      await open({
        editLabelConfig: { index: 2, label: "Renews" },
        editKind: { kind: "date", expires: true },
      })
    ).componentInstance;
    component.variant = "edit";

    expect(component.kindOptions.map((o) => o.value)).toEqual([
      "text",
      "date",
      "url",
      "email",
      "phone",
      "number",
    ]);
    expect(component.kindForm.value).toEqual({ kind: "date", expires: true });

    component.kindForm.patchValue({ kind: "url" });
    component.submit();

    expect(updateLabel).toHaveBeenCalledWith(2, "Renews", "url", false);
  });

  it("offers no hidden kinds where hidden fields aren't allowed", async () => {
    const component = (await open({ disallowHiddenField: true })).componentInstance;

    expect(component.kindOptions.map((o) => o.value)).not.toContain("hidden");
    expect(component.kindOptions.map((o) => o.value)).not.toContain("totp");
  });
});
