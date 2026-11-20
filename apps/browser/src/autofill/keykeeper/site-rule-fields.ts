// Keykeeper: the content script's half of site rules (DESIGN.md, "Fill rules
// for everyone", "In the extension", the selector hook). When the content
// script collects a page's fields, it asks the background for the selectors
// of the site rules for its own frame's address (site-rules.ts), finds each
// with upstream's DomQueryService.queryDeepSelector (`>>>` reaches into a
// shadow root), and marks the field it already collected
// (`keykeeperSelectors`). It never adds a field upstream's collection left
// out, so a rule can't point at a field upstream wouldn't see, and the fill
// rules engine (fill-rules.ts) decides what fills there, with its limits.
// A selector that crosses into a frame finds nothing: a frame's own content
// script gets its own host's rules.

import AutofillField from "../models/autofill-field";
import { DomQueryService } from "../services/abstractions/dom-query.service";

/** The message a content script asks the background for its frame's selectors with. */
export const SITE_RULE_SELECTORS = "keykeeperSiteRuleSelectors";

/** The most selectors a frame resolves: 20 forms, 3 kinds of value, 10 alternatives each. */
export const MAX_SELECTORS = 600;

/** While a page has no selectors (none yet, or the account was locked), how often it asks again. */
const ASK_AGAIN_MS = 2000;

type Asked = { href: string; selectors: string[]; at: number };

export class KeykeeperSiteRuleFields {
  private asked: Asked | null = null;

  constructor(
    private readonly domQueryService: DomQueryService,
    /** The content script's way to ask the background (upstream's sendExtensionMessage). */
    private readonly ask: (command: string) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Marks the collected fields that a site rule's selector finds, and clears any old marks. */
  async mark(fields: Map<Element, AutofillField>): Promise<void> {
    if (fields.size === 0) {
      return;
    }
    const selectors = await this.selectors();
    for (const field of fields.values()) {
      delete field.keykeeperSelectors;
    }
    for (const selector of selectors) {
      const element = this.find(selector);
      const field = element == null ? undefined : fields.get(element);
      if (field != null) {
        (field.keykeeperSelectors ??= []).push(selector);
      }
    }
  }

  /** The selectors for this frame's address, asked once per address (again shortly while there are none). */
  private async selectors(): Promise<string[]> {
    const href = globalThis.location?.href ?? "";
    const asked = this.asked;
    if (
      asked?.href === href &&
      (asked.selectors.length > 0 || this.now() - asked.at < ASK_AGAIN_MS)
    ) {
      return asked.selectors;
    }
    let selectors: string[] = [];
    try {
      const answer = (await this.ask(SITE_RULE_SELECTORS)) as { result?: unknown } | null;
      if (Array.isArray(answer?.result)) {
        selectors = answer.result
          .filter((s): s is string => typeof s === "string")
          .slice(0, MAX_SELECTORS);
      }
    } catch {
      // The background isn't there (an extension update): no rules for now.
    }
    this.asked = { href, selectors, at: this.now() };
    return selectors;
  }

  /** The element a selector finds in this frame, or null, never across into a frame. */
  private find(selector: string): Element | null {
    try {
      if (this.domQueryService.findIframeCrossing(selector) != null) {
        return null;
      }
      return this.domQueryService.queryDeepSelector(selector);
    } catch {
      // Not a selector this browser reads.
      return null;
    }
  }
}
