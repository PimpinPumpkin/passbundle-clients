// Keykeeper: the arithmetic of doing something to several of an MSP's
// templates at once (DESIGN.md, "Selecting several items"). The console asks
// and sends; nothing here talks to the server or decides who may do what.

/** Which clients a template goes to. */
export type TemplateTargets = { allClients: boolean; clients: readonly string[] };

/**
 * What "Applies to" starts from for several templates: what they have in
 * common. "Every client" only when all of them say so; otherwise the clients
 * that every one of them goes to, where a template for every client counts as
 * going to each of them.
 */
export function commonTargets(templates: readonly TemplateTargets[]): {
  allClients: boolean;
  chosen: string[];
} {
  if (templates.length === 0) {
    return { allClients: false, chosen: [] };
  }
  if (templates.every((t) => t.allClients)) {
    return { allClients: true, chosen: [] };
  }
  const chosen = templates
    .filter((t) => !t.allClients)
    .map((t) => [...t.clients])
    .reduce((common, clients) => common.filter((id) => clients.includes(id)));
  return { allClients: false, chosen };
}

/** A client's copy of a template, as the server lists it. */
export type TemplateCopy = { templateId: string; organizationId: string; cipherId: string };

/**
 * The copies of these templates that the person can see, by template. With
 * `targets`, only the ones in clients the templates will no longer go to.
 */
export function copiesByTemplate(
  copies: readonly TemplateCopy[],
  templateIds: readonly string[],
  visible: (cipherId: string) => boolean,
  targets?: readonly string[],
): Map<string, string[]> {
  const byTemplate = new Map(templateIds.map((id): [string, string[]] => [id, []]));
  for (const copy of copies) {
    const list = byTemplate.get(copy.templateId);
    if (list == null || !visible(copy.cipherId)) {
      continue;
    }
    if (targets != null && targets.includes(copy.organizationId)) {
      continue;
    }
    list.push(copy.cipherId);
  }
  return byTemplate;
}

/** "3 templates", "1 template". */
export function templateCount(count: number): string {
  return count === 1 ? "1 template" : `${count} templates`;
}

/**
 * What to say before an action that leaves some of the selected templates
 * out, or "" when it leaves none out.
 */
export function skippedTemplatesNotice(skipped: number, total: number): string {
  if (skipped === 0) {
    return "";
  }
  return skipped === 1
    ? `1 of the ${total} templates you selected will be skipped. You can't see it, so you can't change which clients get it.`
    : `${skipped} of the ${total} templates you selected will be skipped. You can't see them, so you can't change which clients get them.`;
}

/** What to say after it, added to the result. */
export function skippedTemplatesResult(skipped: number): string {
  if (skipped === 0) {
    return "";
  }
  return skipped === 1 ? " 1 template was skipped." : ` ${skipped} templates were skipped.`;
}
