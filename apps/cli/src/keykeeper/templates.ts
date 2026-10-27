// Keykeeper: item templates in the command-line tool (DESIGN.md, "Item
// templates", in the meta repo). `list templates` lists what the web vault's
// "New item from a template" offers: each MSP's, each organization's, the
// person's own, then the built-in ones. `get template <id or name>` gives a new
// item from one, as JSON to fill in and pass to `create item`, the way
// upstream's `get template item` does, with the template's fields (and its
// marker, so the apps show which template the item came from).

import { CipherExport } from "@bitwarden/common/models/export/cipher.export";
import {
  ItemTemplate,
  TemplateFieldKind,
  templateCipherType,
  templateFields,
  templateGroups,
} from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { BaseResponse } from "../models/response/base.response";

/** A template the person can use, and the group the web vault lists it in. */
export type ListedTemplate = {
  template: ItemTemplate;
  /** "From <MSP>", an organization's name, "My templates", or "Built-in". */
  group: string;
};

/** One template, as `list templates` shows it. */
export class ItemTemplateResponse implements BaseResponse {
  object = "itemTemplate";
  id: string;
  name: string;
  /** Where it comes from: "From <MSP>", an organization's name, "My templates", or "Built-in". */
  group: string;
  /** A new item from it is a login (username, password, website) or a secure note. */
  base: "login" | "note";
  /** Its fields, by name and kind (text, hidden, or yes/no); defaults aren't listed. */
  fields: { name: string; kind: TemplateFieldKind }[];

  constructor({ template, group }: ListedTemplate) {
    this.id = template.id;
    this.name = template.name;
    this.group = group;
    this.base = template.base;
    this.fields = template.fields.map((f) => ({ name: f.label, kind: f.kind }));
  }
}

type Organization = { id: string; name: string };

/** Every template the person can use, in the web vault's order. */
export function templatesFor(items: CipherView[], organizations: Organization[]): ListedTemplate[] {
  const live = items.filter((item) => !item.isDeleted);
  return templateGroups(live, organizations).flatMap((group) =>
    group.templates.map((template) => ({ template, group: group.name })),
  );
}

/**
 * The template a script names: by id, or else by name (any case). Null when
 * nothing matches; the ids when several different templates have that name.
 */
export function findTemplate(
  listed: ListedTemplate[],
  idOrName: string,
): ListedTemplate | string[] | null {
  const wanted = idOrName.trim().toLowerCase();
  const byId = listed.filter((t) => t.template.id.toLowerCase() === wanted);
  const matches =
    byId.length > 0 ? byId : listed.filter((t) => t.template.name.toLowerCase() === wanted);
  // An MSP's template is one template, however many of its clients have a copy.
  const distinct = [...new Map(matches.map((t) => [t.template.id, t])).values()];
  if (distinct.length === 0) {
    return null;
  }
  return distinct.length === 1 ? distinct[0] : distinct.map((t) => t.template.id);
}

/**
 * A new item from a template, as `create item` takes it: the template's kind
 * of item, named after it, with its fields and their defaults, and its marker.
 * It belongs to no organization until the script says which, as in the web
 * vault, where an organization's template never puts an item in that
 * organization by itself.
 */
export function itemFromTemplate(template: ItemTemplate): CipherExport {
  const view = new CipherView();
  view.type = templateCipherType(template);
  view.name = template.name;
  view.fields = templateFields(template);
  const item = new CipherExport();
  item.build(view);
  item.creationDate = undefined;
  item.revisionDate = undefined;
  item.passwordHistory = undefined;
  return item;
}
