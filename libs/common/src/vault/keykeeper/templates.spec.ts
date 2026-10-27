import { CipherType, FieldType } from "../enums";
import { FieldView } from "../models/view/field.view";

import {
  BUILT_IN_TEMPLATES,
  customTemplate,
  customTemplates,
  newTemplateDefinitionField,
  TEMPLATE_DEFINITION_FIELD_NAME,
  TEMPLATE_FIELD_NAME,
  templateCipherType,
  templateDefinition,
  templateFields,
  templateFieldsFromItem,
  templateGroups,
  templateOf,
} from "./templates";

const apiKey = BUILT_IN_TEMPLATES.find((t) => t.id === "api-key")!;
const domain = BUILT_IN_TEMPLATES.find((t) => t.id === "domain")!;

describe("Keykeeper item templates", () => {
  it("have unique ids and names, and at least one field each", () => {
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(BUILT_IN_TEMPLATES.length);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.name)).size).toBe(BUILT_IN_TEMPLATES.length);
    expect(BUILT_IN_TEMPLATES.every((t) => t.fields.length > 0)).toBe(true);
  });

  it("build on a login or a note", () => {
    expect(templateCipherType(apiKey)).toBe(CipherType.SecureNote);
    expect(templateCipherType(BUILT_IN_TEMPLATES.find((t) => t.id === "server")!)).toBe(
      CipherType.Login,
    );
  });

  it("start a new item with empty typed fields and a marker", () => {
    const fields = templateFields(apiKey);

    expect(fields.map((f) => [f.name, f.type, f.value])).toEqual([
      ["Key", FieldType.Hidden, ""],
      ["Secret", FieldType.Hidden, ""],
      ["Service URL", FieldType.Text, ""],
      ["Scopes", FieldType.Text, ""],
      [TEMPLATE_FIELD_NAME, FieldType.Text, '{"id":"api-key","name":"API key","v":1}'],
    ]);
    expect(templateFields(domain).find((f) => f.name === "Auto-renew")).toMatchObject({
      type: FieldType.Boolean,
      value: "false",
    });
  });

  it("can tell which template an item came from", () => {
    expect(templateOf({ fields: templateFields(apiKey) })).toBe(apiKey);
    // Items from before the name was recorded.
    expect(
      templateOf({ fields: [{ name: TEMPLATE_FIELD_NAME, value: '{"id":"api-key","v":1}' }] }),
    ).toBe(apiKey);
    expect(templateOf({ fields: [] })).toBeNull();
    expect(templateOf({ fields: [{ name: TEMPLATE_FIELD_NAME, value: "not json" }] })).toBeNull();
    expect(
      templateOf({ fields: [{ name: TEMPLATE_FIELD_NAME, value: '{"id":"gone"}' }] }),
    ).toBeNull();
  });
});

function field(name: string, type: FieldType, value: string): FieldView {
  const f = new FieldView();
  f.name = name;
  f.type = type;
  f.value = value;
  return f;
}

const laptopTemplate = {
  id: "cipher-1",
  name: " Client laptop ",
  type: CipherType.SecureNote,
  organizationId: "org-1",
  viewPassword: true,
  fields: [
    field("Asset tag", FieldType.Text, ""),
    field("BitLocker recovery key", FieldType.Hidden, ""),
    field("Site", FieldType.Text, "Main office"),
    field("Encrypted", FieldType.Boolean, "true"),
    newTemplateDefinitionField("login", "4f6c8a3e-1d2b-4c5a-9e7f-0a1b2c3d4e5f"),
  ],
};

describe("Keykeeper custom templates", () => {
  it("are notes whose name and custom fields are the template", () => {
    const template = customTemplate(laptopTemplate)!;

    expect(template).toMatchObject({
      id: "4f6c8a3e-1d2b-4c5a-9e7f-0a1b2c3d4e5f",
      name: "Client laptop",
      base: "login",
      source: { cipherId: "cipher-1", organizationId: "org-1" },
    });
    expect(template.fields).toEqual([
      { label: "Asset tag", kind: "text", value: "" },
      { label: "BitLocker recovery key", kind: "hidden", value: "" },
      { label: "Site", kind: "text", value: "Main office" },
      { label: "Encrypted", kind: "boolean", value: "true" },
    ]);
  });

  it("Keykeeper: leave a hidden default out for someone who can't see the note's passwords", () => {
    const withSecret = {
      ...laptopTemplate,
      fields: [
        field("BitLocker recovery key", FieldType.Hidden, "1234-5678-9012"),
        field("Site", FieldType.Text, "Main office"),
        newTemplateDefinitionField("login", "4f6c8a3e-1d2b-4c5a-9e7f-0a1b2c3d4e5f"),
      ],
    };

    // Someone who can see them gets the default.
    expect(templateFields(customTemplate(withSecret)!).map((f) => f.value)).toEqual([
      "1234-5678-9012",
      "Main office",
      expect.any(String),
    ]);

    // Someone who can't, and an item that doesn't say: the field, empty.
    for (const hidden of [
      { ...withSecret, viewPassword: false },
      { ...withSecret, viewPassword: undefined },
    ]) {
      const template = customTemplate(hidden)!;
      expect(template.fields).toEqual([
        { label: "BitLocker recovery key", kind: "hidden", value: undefined },
        { label: "Site", kind: "text", value: "Main office" },
      ]);
      const fields = templateFields(template);
      expect(fields.map((f) => [f.name, f.type, f.value]).slice(0, 2)).toEqual([
        ["BitLocker recovery key", FieldType.Hidden, ""],
        ["Site", FieldType.Text, "Main office"],
      ]);
      expect(JSON.stringify(fields)).not.toContain("1234-5678-9012");
    }
  });

  it("Keykeeper: a template someone without see passwords made, by naming a field, copies none of the note's secrets for them", () => {
    // A note they can edit but not see the passwords of, with a hidden field,
    // turned into a template by a text field with the definition's name.
    const note = {
      id: "cipher-2",
      name: "Server room",
      type: CipherType.SecureNote,
      organizationId: "org-1",
      viewPassword: false,
      fields: [
        field("Door code", FieldType.Hidden, "4421-8830"),
        field(
          "keykeeper.template-definition",
          FieldType.Text,
          '{"id":"made-up","base":"note","v":1}',
        ),
      ],
    };
    const template = customTemplate(note);
    expect(template).not.toBeNull();
    expect(JSON.stringify(templateFields(template!))).not.toContain("4421-8830");
  });

  it("give new items their fields and defaults, and their name", () => {
    const template = customTemplate(laptopTemplate)!;
    const fields = templateFields(template);

    expect(templateCipherType(template)).toBe(CipherType.Login);
    expect(fields.map((f) => [f.name, f.type, f.value])).toEqual([
      ["Asset tag", FieldType.Text, ""],
      ["BitLocker recovery key", FieldType.Hidden, ""],
      ["Site", FieldType.Text, "Main office"],
      ["Encrypted", FieldType.Boolean, "true"],
      [
        TEMPLATE_FIELD_NAME,
        FieldType.Text,
        '{"id":"4f6c8a3e-1d2b-4c5a-9e7f-0a1b2c3d4e5f","name":"Client laptop","v":1}',
      ],
    ]);
    // Never the definition itself, which would make the new item a template.
    expect(fields.some((f) => f.name === TEMPLATE_DEFINITION_FIELD_NAME)).toBe(false);
    // Known by name, even to someone who can't see the template.
    expect(templateOf({ fields })).toEqual({
      id: "4f6c8a3e-1d2b-4c5a-9e7f-0a1b2c3d4e5f",
      name: "Client laptop",
      icon: "bwi-file-text",
    });
  });

  it("skip linked fields, which belong to one item", () => {
    const linked = field("Linked", FieldType.Linked, "");
    const template = customTemplate({
      ...laptopTemplate,
      fields: [...laptopTemplate.fields, linked],
    });

    expect(template!.fields.map((f) => f.label)).not.toContain("Linked");
  });

  it("ignore anything that isn't a live note with a valid definition", () => {
    const withDefinition = (value: string) => ({
      ...laptopTemplate,
      fields: [field(TEMPLATE_DEFINITION_FIELD_NAME, FieldType.Text, value)],
    });

    expect(customTemplate({ ...laptopTemplate, type: CipherType.Login })).toBeNull();
    expect(customTemplate({ ...laptopTemplate, deletedDate: new Date() })).toBeNull();
    expect(customTemplate({ ...laptopTemplate, fields: [] })).toBeNull();
    for (const bad of [
      "not json",
      "[]",
      '{"id":"x","base":"login"}',
      '{"id":"x","base":"card","v":1}',
      '{"id":"has spaces","base":"note","v":1}',
      `{"id":"${"a".repeat(65)}","base":"note","v":1}`,
      '{"id":7,"base":"note","v":1}',
      '{"id":"x","base":"note","v":2}',
    ]) {
      expect(customTemplate(withDefinition(bad))).toBeNull();
    }
    expect(templateDefinition(withDefinition('{"id":"x","base":"note","v":1}'))).toEqual({
      id: "x",
      base: "note",
    });
  });

  it("are listed by name, with a fallback for an unnamed one", () => {
    const named = (name: string) => ({ ...laptopTemplate, name });

    expect(customTemplates([named("Wi-Fi"), named(""), named("Asset")]).map((t) => t.name)).toEqual(
      ["Asset", "Untitled template", "Wi-Fi"],
    );
  });

  it("each get a fresh id", () => {
    const a = templateDefinition({ fields: [newTemplateDefinitionField("note")] });
    const b = templateDefinition({ fields: [newTemplateDefinitionField("note")] });

    expect(a!.id).not.toBe(b!.id);
    expect(a!.base).toBe("note");
  });

  it("are offered by organization, then the person's own, then built-in", () => {
    const template = (name: string, organizationId: string | null) => ({
      ...laptopTemplate,
      id: name,
      name,
      organizationId,
    });
    const groups = templateGroups(
      [
        template("Zeta laptop", "org-z"),
        template("Alpha server", "org-a"),
        template("My Wi-Fi", null),
        template("Orphan", "org-gone"),
      ],
      [
        { id: "org-z", name: "Zeta Dental" },
        { id: "org-a", name: "Acme Law" },
        { id: "org-empty", name: "Empty Org" },
      ],
    );

    expect(groups.map((g) => [g.name, g.templates.map((t) => t.name)])).toEqual([
      ["Acme Law", ["Alpha server"]],
      ["Zeta Dental", ["Zeta laptop"]],
      ["My templates", ["My Wi-Fi"]],
      ["Built-in", BUILT_IN_TEMPLATES.map((t) => t.name)],
    ]);
  });

  it("from an MSP are offered once under the MSP's name, however many clients send them", () => {
    const copy = (
      cipherId: string,
      organizationId: string | null,
      id: string,
      name: string,
      from?: string,
    ) => ({
      ...laptopTemplate,
      id: cipherId,
      name,
      organizationId,
      fields: [newTemplateDefinitionField("note", id, from)],
    });
    const groups = templateGroups(
      [
        copy("c1", "org-a", "fw", "Firewall", "Northwind IT"),
        copy("c2", "org-z", "fw", "Firewall", "Northwind IT"),
        copy("c3", "org-z", "m365", "Microsoft 365", "Northwind IT"),
        copy("c4", "org-a", "own", "Front desk PC"),
        // A "from" in someone's own vault isn't a copy an MSP sent.
        copy("c5", null, "mine", "My server", "Northwind IT"),
      ],
      [
        { id: "org-z", name: "Zeta Dental" },
        { id: "org-a", name: "Acme Law" },
      ],
    );

    expect(groups.map((g) => [g.name, g.templates.map((t) => t.name)])).toEqual([
      ["From Northwind IT", ["Firewall", "Microsoft 365"]],
      ["Acme Law", ["Front desk PC"]],
      ["My templates", ["My server"]],
      ["Built-in", BUILT_IN_TEMPLATES.map((t) => t.name)],
    ]);
  });

  it("read the MSP a copy came from, and ignore a blank or overlong one", () => {
    const withFrom = (from: string) => ({
      fields: [newTemplateDefinitionField("note", "t1", from)],
    });
    expect(templateDefinition(withFrom(" Northwind IT "))).toEqual({
      id: "t1",
      base: "note",
      from: "Northwind IT",
    });
    expect(templateDefinition(withFrom("   "))).toEqual({ id: "t1", base: "note" });
    expect(templateDefinition(withFrom("x".repeat(101)))).toEqual({ id: "t1", base: "note" });
  });
});

describe("templateFieldsFromItem", () => {
  const field = (name: string, type: FieldType, value: string) =>
    Object.assign(new FieldView(), { name, type, value });

  it("takes a login's own custom fields by label and kind, never their values", () => {
    const fields = templateFieldsFromItem({
      type: CipherType.Login,
      fields: [
        field("Tenant", FieldType.Text, "contoso.onmicrosoft.com"),
        field("Break-glass PIN", FieldType.Hidden, "8462"),
        field("MFA enforced", FieldType.Boolean, "true"),
        field("Linked", FieldType.Linked, "100"),
        field("keykeeper.expires", FieldType.Text, "2027-01-01"),
      ],
    })!;

    expect(fields.slice(0, -1).map((f) => [f.name, f.type, f.value])).toEqual([
      ["Tenant", FieldType.Text, ""],
      ["Break-glass PIN", FieldType.Hidden, ""],
      ["MFA enforced", FieldType.Boolean, "false"],
    ]);
    expect(templateDefinition({ fields })).toEqual({ id: expect.any(String), base: "login" });
  });

  it("makes a note template from a note", () => {
    const fields = templateFieldsFromItem({ type: CipherType.SecureNote, fields: [] })!;
    expect(fields).toHaveLength(1);
    expect(templateDefinition({ fields })?.base).toBe("note");
  });

  it("makes nothing from a template, or from a kind of item templates don't cover", () => {
    const template = { type: CipherType.SecureNote, fields: [newTemplateDefinitionField("login")] };
    expect(templateFieldsFromItem(template)).toBeNull();
    expect(templateFieldsFromItem({ type: CipherType.Card, fields: [] })).toBeNull();
  });
});
