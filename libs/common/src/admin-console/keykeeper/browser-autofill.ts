// Keykeeper: what an organization does with the browsers' own card and
// address autofill (DESIGN.md, "Addresses and cards", in the meta repo). The
// server sends it with each organization in sync (`keykeeperBrowserAutofill`).

/** Leave them as they are, turn them off, or turn them off and offer to bring them in. */
export type BrowserAutofillMode = "unchanged" | "off" | "offAndImport";

/** The value the server sent, or "unchanged" for anything else (an older server says nothing). */
export function browserAutofillMode(value: unknown): BrowserAutofillMode {
  return value === "off" || value === "offAndImport" ? value : "unchanged";
}

/** What the browser extension needs to know about one organization. */
export type BrowserAutofillOrg = {
  id: string;
  name: string;
  /** A confirmed member whose membership is on. */
  member: boolean;
  keykeeperBrowserAutofill: BrowserAutofillMode;
};

/**
 * The organizations that turn the browsers' card and address autofill off
 * for this person: those they're a confirmed member of whose setting is off.
 * An invited or revoked membership never counts.
 */
export function orgsTurningOffBrowserAutofill(orgs: BrowserAutofillOrg[]): BrowserAutofillOrg[] {
  return orgs.filter((o) => o.member && o.keykeeperBrowserAutofill !== "unchanged");
}
