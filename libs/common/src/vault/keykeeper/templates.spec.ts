import { CipherType, FieldType } from "../enums";
import { FieldView } from "../models/view/field.view";

import { storedExpiration } from "./expiration";
import {
  BUILT_IN_TEMPLATES,
  customTemplate,
  customTemplates,
  expirationFieldOf,
  fieldKind,
  isOwnTemplate,
  itemTyping,
  newTemplateDefinitionField,
  TEMPLATE_DEFINITION_FIELD_NAME,
  TEMPLATE_FIELD_NAME,
  templateCipherType,
  templateDefinition,
  templateFields,
  templateFieldsFromItem,
  templateGroups,
  templateOf,
  typedFieldProblem,
  typingOf,
  withTyping,
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

    // The marker carries the template's typed fields, from code for a built-in one.
    expect(fields.map((f) => [f.name, f.type, f.value])).toEqual([
      ["Key", FieldType.Hidden, ""],
      ["Secret", FieldType.Hidden, ""],
      ["Service URL", FieldType.Text, ""],
      ["Scopes", FieldType.Text, ""],
      [
        TEMPLATE_FIELD_NAME,
        FieldType.Text,
        '{"id":"api-key","name":"API key","v":1,"types":{"Service URL":"url"}}',
      ],
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

  describe("copied into several organizations", () => {
    const copy = (
      cipherId: string,
      organizationId: string | null,
      id: string,
      name: string,
      from?: string,
      fieldLabel = "Management URL",
    ) => ({
      ...laptopTemplate,
      id: cipherId,
      name,
      organizationId,
      fields: [
        Object.assign(new FieldView(), { name: fieldLabel, type: FieldType.Text, value: "" }),
        newTemplateDefinitionField("note", id, from),
      ],
    });
    const organizations = [
      { id: "org-z", name: "Zeta Dental" },
      { id: "org-a", name: "Acme Law" },
      { id: "org-n", name: "Northwind Team" },
    ];
    const shown = (groups: ReturnType<typeof templateGroups>) =>
      groups
        .filter((g) => g.name !== "Built-in")
        .map((g) => [g.name, g.templates.map((t) => `${t.name} (${t.source?.cipherId})`)]);

    it("are offered once, where the original is when the person sees it", () => {
      const groups = templateGroups(
        [
          copy("c1", "org-a", "fw", "Firewall", "Northwind IT"),
          copy("c2", "org-z", "fw", "Firewall", "Northwind IT"),
          copy("src", "org-n", "fw", "Firewall"),
          copy("c3", "org-z", "m365", "Microsoft 365", "Northwind IT"),
          copy("c4", "org-a", "m365", "Microsoft 365", "Northwind IT"),
          copy("c5", "org-a", "own", "Front desk PC"),
        ],
        organizations,
      );

      expect(shown(groups)).toEqual([
        ["Acme Law", ["Front desk PC (c5)", "Microsoft 365 (c4)"]],
        ["Northwind Team", ["Firewall (src)"]],
      ]);
    });

    it("never say who they're from, whatever the item claims", () => {
      // A member of Zeta Dental writes a template that says it's the MSP's.
      const groups = templateGroups(
        [copy("forged", "org-z", "fw", "Firewall", "Northwind IT", "Send passwords to")],
        organizations,
      );

      expect(groups.map((g) => g.name)).toEqual(["Zeta Dental", "Built-in"]);
      expect(groups[0].templates[0]).not.toHaveProperty("from");
    });

    it("are offered where they are when they differ, so a changed copy can't hide behind the original", () => {
      const groups = templateGroups(
        [
          copy("src", "org-n", "fw", "Firewall"),
          copy("c1", "org-a", "fw", "Firewall", "Northwind IT"),
          copy("forged", "org-z", "fw", "Firewall", "Northwind IT", "Send passwords to"),
        ],
        organizations,
      );

      expect(shown(groups)).toEqual([
        ["Northwind Team", ["Firewall (src)"]],
        ["Zeta Dental", ["Firewall (forged)"]],
      ]);
    });

    it("in the same organization are each offered", () => {
      const groups = templateGroups(
        [
          copy("c1", "org-a", "fw", "Firewall", "Northwind IT"),
          copy("c2", "org-a", "fw", "Firewall", "Northwind IT"),
        ],
        organizations,
      );

      expect(shown(groups)).toEqual([["Acme Law", ["Firewall (c1)", "Firewall (c2)"]]]);
    });
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

describe('typed fields (DESIGN.md, "Where a field\'s type is kept")', () => {
  const text = (name: string, value = "") => field(name, FieldType.Text, value);
  const hidden = (name: string, value = "") => field(name, FieldType.Hidden, value);
  const definition = (extra: object) =>
    field(
      TEMPLATE_DEFINITION_FIELD_NAME,
      FieldType.Text,
      JSON.stringify({ id: "t-1", base: "note", v: 1, ...extra }),
    );
  const licenseTemplate = {
    id: "cipher-9",
    name: "Software license",
    type: CipherType.SecureNote,
    organizationId: null,
    viewPassword: true,
    fields: [
      text("Vendor site"),
      text("Renews"),
      text("Seats"),
      hidden("Admin console code"),
      field("Auto-renew", FieldType.Boolean, "false"),
      definition({
        types: {
          "Vendor site": "url",
          Renews: "date",
          Seats: "number",
          "Admin console code": "totp",
        },
        expires: "Renews",
      }),
    ],
  };

  it("are read from a template's definition, with its expiration date field", () => {
    expect(customTemplate(licenseTemplate)!.fields).toEqual([
      { label: "Vendor site", kind: "url", value: "" },
      { label: "Renews", kind: "date", value: "", expires: true },
      { label: "Seats", kind: "number", value: "" },
      { label: "Admin console code", kind: "totp", value: "" },
      { label: "Auto-renew", kind: "boolean", value: "false" },
    ]);
  });

  it("go into a new item's marker, stored as text and hidden fields", () => {
    const fields = templateFields(customTemplate(licenseTemplate)!);

    expect(fields.slice(0, 4).map((f) => [f.name, f.type])).toEqual([
      ["Vendor site", FieldType.Text],
      ["Renews", FieldType.Text],
      ["Seats", FieldType.Text],
      ["Admin console code", FieldType.Hidden],
    ]);
    expect(JSON.parse(fields.find((f) => f.name === TEMPLATE_FIELD_NAME)!.value)).toEqual({
      id: "t-1",
      name: "Software license",
      v: 1,
      types: {
        "Vendor site": "url",
        Renews: "date",
        Seats: "number",
        "Admin console code": "totp",
      },
      expires: "Renews",
    });
    // So the item knows them without the template.
    expect(itemTyping({ fields })).toEqual({
      types: {
        "Vendor site": "url",
        Renews: "date",
        Seats: "number",
        "Admin console code": "totp",
      },
      expires: "Renews",
    });
  });

  it("come from code for the built-in templates", () => {
    const kinds = (id: string) =>
      Object.fromEntries(
        BUILT_IN_TEMPLATES.find((t) => t.id === id)!
          .fields.filter((f) => !["text", "hidden", "boolean"].includes(f.kind))
          .map((f) => [f.label, f.kind]),
      );
    expect(kinds("api-key")).toEqual({ "Service URL": "url" });
    expect(kinds("server")).toEqual({ Port: "number" });
    expect(kinds("database")).toEqual({ Port: "number" });
    expect(kinds("software-license")).toEqual({ "Purchase date": "date" });
    expect(kinds("email-account")).toEqual({ Port: "number" });
    expect(kinds("membership")).toEqual({ Phone: "phone" });
  });

  it("fall back to the field's own type for a type nobody knows, or one that doesn't fit", () => {
    const typing = typingOf(
      JSON.parse(
        '{"types":{"Later":"fingerprint","Hidden":"date","Code":"totp","Odd":7,"__proto__":"url"},"expires":"Code"}',
      ),
    );
    expect(typing).toEqual({ types: { Hidden: "date", Code: "totp" } });
    // An unknown type is text.
    expect(fieldKind(text("Later"), typing)).toBe("text");
    // A date must be a text field, a one-time code a hidden one.
    expect(fieldKind(hidden("Hidden"), typing)).toBe("hidden");
    expect(fieldKind(text("Code"), typing)).toBe("text");
    expect(fieldKind(hidden("Code"), typing)).toBe("totp");
    expect(fieldKind(field("Linked", FieldType.Linked, ""), typing)).toBeNull();
    // Nothing odd from the object's own properties.
    expect(fieldKind(text("constructor"), typing)).toBe("text");
    // Expires only names a date field.
    expect(typingOf({ types: { A: "url" }, expires: "A" })).toEqual({ types: { A: "url" } });
    expect(typingOf({ types: { A: "date" }, expires: "B" })).toEqual({ types: { A: "date" } });
  });

  it("are written over a definition or marker, keeping the rest of it", () => {
    const marker = '{"id":"t-1","name":"License","v":1,"types":{"Old":"url"},"expires":"Old"}';

    expect(withTyping(marker, { types: { Renews: "date" }, expires: "Renews" })).toBe(
      '{"id":"t-1","name":"License","v":1,"types":{"Renews":"date"},"expires":"Renews"}',
    );
    expect(withTyping(marker, { types: {} })).toBe('{"id":"t-1","name":"License","v":1}');
    expect(withTyping("not json", { types: {} })).toBeNull();
  });

  it("come along with Save as template, labels and kinds only", () => {
    const item = {
      type: CipherType.SecureNote,
      fields: [
        text("Vendor site", "https://vendor.example"),
        text("Renews", "2027-03-31"),
        hidden("Admin console code", "JBSWY3DPEHPK3PXP"),
        ...templateFields(customTemplate(licenseTemplate)!).filter(
          (f) => f.name === TEMPLATE_FIELD_NAME,
        ),
      ],
    };
    const fields = templateFieldsFromItem(item)!;
    const made = customTemplate({ ...licenseTemplate, fields })!;

    expect(made.fields).toEqual([
      { label: "Vendor site", kind: "url", value: "" },
      { label: "Renews", kind: "date", value: "", expires: true },
      { label: "Admin console code", kind: "totp", value: "" },
    ]);
    expect(JSON.stringify(fields)).not.toContain("JBSWY3DPEHPK3PXP");
    expect(JSON.stringify(fields)).not.toContain("2027-03-31");
  });

  it("keep a hidden default from someone who can't see the template's passwords", () => {
    const withSecret = {
      ...licenseTemplate,
      viewPassword: false,
      fields: [
        hidden("Admin console code", "JBSWY3DPEHPK3PXP"),
        definition({ types: { "Admin console code": "totp" } }),
      ],
    };
    const template = customTemplate(withSecret)!;

    expect(template.fields).toEqual([
      { label: "Admin console code", kind: "totp", value: undefined },
    ]);
    expect(JSON.stringify(templateFields(template))).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("are checked, warning only, and an empty field is fine", () => {
    expect(typedFieldProblem("url", "https://vendor.example/login")).toBeNull();
    expect(typedFieldProblem("url", "vendor.example")).toBeNull();
    expect(typedFieldProblem("url", "not a site")).toBe("This doesn't look like a web address.");
    expect(typedFieldProblem("url", "ftp://vendor.example")).toBe(
      "This doesn't look like a web address.",
    );
    expect(typedFieldProblem("email", "it@contoso.example")).toBeNull();
    expect(typedFieldProblem("email", "it@contoso")).toBe(
      "This doesn't look like an email address.",
    );
    expect(typedFieldProblem("phone", "+1 (555) 010-4477")).toBeNull();
    expect(typedFieldProblem("phone", "call me")).toBe("This doesn't look like a phone number.");
    expect(typedFieldProblem("phone", "12")).toBe("This doesn't look like a phone number.");
    expect(typedFieldProblem("number", "8443")).toBeNull();
    expect(typedFieldProblem("number", "-1,250.5")).toBeNull();
    expect(typedFieldProblem("number", "about 3")).toBe("This isn't a number.");
    expect(typedFieldProblem("date", "2027-03-31")).toBeNull();
    expect(typedFieldProblem("date", "2027-02-30")).toBe(
      "Write the date as year, month, and day, such as 2027-03-31.",
    );
    for (const kind of ["url", "email", "phone", "number", "date"] as const) {
      expect(typedFieldProblem(kind, "")).toBeNull();
      expect(typedFieldProblem(kind, "  ")).toBeNull();
    }
    expect(typedFieldProblem("text", "anything")).toBeNull();
    expect(typedFieldProblem("totp", "anything")).toBeNull();
  });
});

describe('a template\'s expiration date field (DESIGN.md, "A date field that sets Expires")', () => {
  const marker = (extra: object) =>
    field(
      TEMPLATE_FIELD_NAME,
      FieldType.Text,
      JSON.stringify({ id: "t-1", name: "License", v: 1, ...extra }),
    );
  const item = (renews: string, expires?: string) => ({
    fields: [
      field("Renews", FieldType.Text, renews),
      marker({ types: { Renews: "date" }, expires: "Renews" }),
      ...(expires ? [field("keykeeper.expires", FieldType.Text, expires)] : []),
    ],
  });

  it("is the item's expiration date, and wins while it holds a date", () => {
    expect(expirationFieldOf(item("2027-03-31"))?.value).toBe("2027-03-31");
    expect(storedExpiration(item("2027-03-31", "2027-03-31"))).toBe("2027-03-31");
    // Another app changed one and not the other: the field wins.
    expect(storedExpiration(item("2027-06-30", "2027-03-31"))).toBe("2027-06-30");
    // Without a date in it, Expires stands.
    expect(storedExpiration(item("", "2027-03-31"))).toBe("2027-03-31");
    expect(storedExpiration(item("next spring", "2027-03-31"))).toBe("2027-03-31");
    expect(storedExpiration(item("2027-06-30"))).toBe("2027-06-30");
  });

  it("is only a date text field the marker names", () => {
    const notDate = {
      fields: [
        field("Renews", FieldType.Text, "2027-06-30"),
        marker({ types: { Renews: "url" }, expires: "Renews" }),
      ],
    };
    expect(expirationFieldOf(notDate)).toBeNull();
    expect(storedExpiration(notDate)).toBeNull();
    const unmarked = {
      fields: [
        field("Renews", FieldType.Text, "2027-06-30"),
        marker({ types: { Renews: "date" } }),
      ],
    };
    expect(storedExpiration(unmarked)).toBeNull();
  });

  it("is a default on a template, never the template's own expiration", () => {
    const template = {
      type: CipherType.SecureNote,
      fields: [
        field("Renews", FieldType.Text, "2027-06-30"),
        field(
          TEMPLATE_DEFINITION_FIELD_NAME,
          FieldType.Text,
          JSON.stringify({
            id: "t-1",
            base: "note",
            v: 1,
            types: { Renews: "date" },
            expires: "Renews",
          }),
        ),
      ],
    };
    expect(expirationFieldOf(template)).toBeNull();
    expect(storedExpiration(template)).toBeNull();
  });
});

describe("isOwnTemplate", () => {
  const definition = (extra: object = {}) =>
    field(
      TEMPLATE_DEFINITION_FIELD_NAME,
      FieldType.Text,
      JSON.stringify({ id: "t-1", base: "note", v: 1, ...extra }),
    );

  it("is a note with a definition, not an MSP's copy, as a full view or a list view", () => {
    expect(isOwnTemplate({ type: CipherType.SecureNote, fields: [definition()] })).toBe(true);
    expect(isOwnTemplate({ type: "secureNote", fields: [definition()] })).toBe(true);
    expect(
      isOwnTemplate({ type: CipherType.SecureNote, fields: [definition({ from: "MSP" })] }),
    ).toBe(false);
    expect(isOwnTemplate({ type: CipherType.Login, fields: [definition()] })).toBe(false);
    expect(isOwnTemplate({ type: CipherType.SecureNote, fields: [] })).toBe(false);
  });
});
