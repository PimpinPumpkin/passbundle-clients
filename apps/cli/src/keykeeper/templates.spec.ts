// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// Keykeeper: see templates.ts.
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import {
  newTemplateDefinitionField,
  TEMPLATE_FIELD_NAME,
} from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { findTemplate, ItemTemplateResponse, itemFromTemplate, templatesFor } from "./templates";

const orgId = "22222222-2222-2222-2222-222222222222";

/** A custom template: a secure note with a definition field and the template's fields. */
function customTemplate(name: string, organizationId: string | null, viewPassword = true) {
  const item = new CipherView();
  item.id = `${name}-item`;
  item.type = CipherType.SecureNote;
  item.name = name;
  item.organizationId = organizationId;
  item.viewPassword = viewPassword;
  item.fields = [
    Object.assign(new FieldView(), { name: "Hostname", type: FieldType.Text, value: "" }),
    Object.assign(new FieldView(), {
      name: "Local admin password",
      type: FieldType.Hidden,
      value: "default-secret",
    }),
    newTemplateDefinitionField("login", `${name.toLowerCase().replace(/\W+/g, "-")}-id`),
  ];
  return item;
}

describe("item templates in the command-line tool", () => {
  const items = [customTemplate("Workstation", orgId), customTemplate("Home router", null)];
  const organizations = [{ id: orgId, name: "Contoso" }];

  it("lists each organization's, the person's own, then the built-in ones", () => {
    const listed = templatesFor(items, organizations).map((t) => new ItemTemplateResponse(t));
    expect(listed.map((t) => [t.group, t.name]).slice(0, 2)).toEqual([
      ["Contoso", "Workstation"],
      ["My templates", "Home router"],
    ]);
    expect(listed.filter((t) => t.group === "Built-in").map((t) => t.id)).toContain("wifi");
    expect(listed[0].fields).toEqual([
      { name: "Hostname", kind: "text" },
      { name: "Local admin password", kind: "hidden" },
    ]);
    // Defaults aren't listed.
    expect(JSON.stringify(listed)).not.toContain("default-secret");
  });

  it("leaves out templates in the trash", () => {
    const trashed = customTemplate("Old server", null);
    trashed.deletedDate = new Date();
    expect(templatesFor([trashed], []).map((t) => t.template.name)).not.toContain("Old server");
  });

  it("finds a template by id or name, in any case", () => {
    const listed = templatesFor(items, organizations);
    expect((findTemplate(listed, "wifi") as any).template.name).toBe("Wi-Fi network");
    expect((findTemplate(listed, "WI-FI NETWORK") as any).template.id).toBe("wifi");
    expect((findTemplate(listed, "workstation") as any).group).toBe("Contoso");
    expect(findTemplate(listed, "nothing like it")).toBeNull();
  });

  it("lists the ids when two templates share a name", () => {
    const twins = [customTemplate("Laptop", null), customTemplate("Laptop", orgId)];
    twins[1].fields[2] = newTemplateDefinitionField("login", "other-laptop-id");
    expect(findTemplate(templatesFor(twins, organizations), "laptop")).toEqual(
      expect.arrayContaining(["laptop-id", "other-laptop-id"]),
    );
    // An id comes first: the built-in Server template, not a custom one named "server".
    const named = [customTemplate("server", null)];
    expect((findTemplate(templatesFor(named, []), "server") as any).group).toBe("Built-in");
  });

  it("makes a new item with the template's fields, its defaults, and its marker", () => {
    const listed = templatesFor(items, organizations);
    const item = itemFromTemplate((findTemplate(listed, "workstation") as any).template);
    expect(item.type).toBe(CipherType.Login);
    expect(item.name).toBe("Workstation");
    expect(item.organizationId).toBeUndefined();
    expect(item.fields.map((f) => [f.name, f.type, f.value])).toEqual([
      ["Hostname", FieldType.Text, ""],
      ["Local admin password", FieldType.Hidden, "default-secret"],
      [TEMPLATE_FIELD_NAME, FieldType.Text, expect.stringContaining('"id":"workstation-id"')],
    ]);
  });

  it("never copies a hidden default someone can't see", () => {
    const hidden = [customTemplate("Workstation", orgId, false)];
    const listed = templatesFor(hidden, organizations);
    const item = itemFromTemplate((findTemplate(listed, "workstation") as any).template);
    expect(JSON.stringify(item)).not.toContain("default-secret");
  });

  it("makes notes from the built-in note templates", () => {
    const listed = templatesFor([], []);
    const item = itemFromTemplate((findTemplate(listed, "api-key") as any).template);
    expect(item.type).toBe(CipherType.SecureNote);
    expect(item.secureNote).toBeDefined();
    expect(item.fields.map((f) => f.name)).toEqual([
      "Key",
      "Secret",
      "Service URL",
      "Scopes",
      TEMPLATE_FIELD_NAME,
    ]);
  });
});
