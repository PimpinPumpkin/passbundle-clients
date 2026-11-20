import AutofillField from "../models/autofill-field";
import { CollectAutofillContentService } from "../services/collect-autofill-content.service";
import DomElementVisibilityService from "../services/dom-element-visibility.service";
import { DomQueryService } from "../services/dom-query.service";

import { KeykeeperSiteRuleFields, SITE_RULE_SELECTORS } from "./site-rule-fields";

/** The page's inputs as the content script collected them: element to field. */
function collected(root: Document | ShadowRoot = document) {
  const fields = new Map<Element, AutofillField>();
  root.querySelectorAll("input").forEach((input, i) => {
    fields.set(input, { opid: `__${i}`, htmlID: input.id } as AutofillField);
  });
  return fields;
}

describe("Fields site rules find by selector", () => {
  const domQueryService = new DomQueryService();
  let answer: unknown;
  let asked: string[];
  let now: number;
  const marker = () =>
    new KeykeeperSiteRuleFields(
      domQueryService,
      async (command) => {
        asked.push(command);
        return answer;
      },
      () => now,
    );

  beforeEach(() => {
    asked = [];
    now = 1_000_000;
    document.body.innerHTML = `
      <input id="search" type="search" />
      <signin-box id="signin-box"></signin-box>
      <iframe id="login"></iframe>
    `;
    const shadow = document.getElementById("signin-box")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<form><input id="secret" type="password" /><input id="member-number" /></form>`;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks the field a selector finds inside a shadow root, as upstream's deep selector finds it", async () => {
    const shadow = document.getElementById("signin-box")!.shadowRoot!;
    const fields = new Map([...collected(), ...collected(shadow)]);
    answer = { result: ["#signin-box >>> #member-number", "#signin-box >>> #secret", "#nothing"] };

    await marker().mark(fields);

    expect(asked).toEqual([SITE_RULE_SELECTORS]);
    const marked = [...fields.values()].filter((f) => f.keykeeperSelectors);
    expect(marked.map((f) => [f.htmlID, f.keykeeperSelectors])).toEqual([
      ["secret", ["#signin-box >>> #secret"]],
      ["member-number", ["#signin-box >>> #member-number"]],
    ]);
  });

  it("marks only fields already collected, never one upstream's collection left out", async () => {
    const fields = collected();
    fields.delete(document.getElementById("search")!);
    answer = { result: ["#search"] };

    await marker().mark(fields);
    expect([...fields.values()].some((f) => f.keykeeperSelectors)).toBe(false);
  });

  it("finds nothing across into a frame: the frame's own content script has its host's rules", async () => {
    const frame = document.getElementById("login") as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = `<input id="inner" />`;
    const inner = frame.contentDocument!.getElementById("inner")!;
    // Upstream's deep selector itself would reach it.
    expect(domQueryService.queryDeepSelector("#login >>> #inner")).toBe(inner);
    const fields = collected();
    fields.set(inner, { opid: "inner", htmlID: "inner" } as AutofillField);
    answer = { result: ["iframe#login >>> #inner", "#login >>> #inner"] };

    await marker().mark(fields);
    expect([...fields.values()].some((f) => f.keykeeperSelectors)).toBe(false);
  });

  it("skips a selector the browser can't read, and keeps the rest", async () => {
    const fields = collected();
    answer = { result: ["input[", 7, "#search"] };

    await marker().mark(fields);
    expect(fields.get(document.getElementById("search")!)!.keykeeperSelectors).toEqual(["#search"]);
  });

  it("clears old marks, and asks once per address, again shortly while there are none", async () => {
    const fields = collected();
    const fieldsMarker = marker();
    answer = { result: [] };
    await fieldsMarker.mark(fields);
    await fieldsMarker.mark(fields);
    expect(asked).toHaveLength(1);

    now += 2000;
    answer = { result: ["#search"] };
    await fieldsMarker.mark(fields);
    expect(asked).toHaveLength(2);
    expect(fields.get(document.getElementById("search")!)!.keykeeperSelectors).toEqual(["#search"]);

    now += 60_000;
    answer = { result: [] };
    await fieldsMarker.mark(fields);
    expect(asked).toHaveLength(2);

    window.history.pushState({}, "", "/another-page");
    await fieldsMarker.mark(fields);
    expect(asked).toHaveLength(3);
    expect(fields.get(document.getElementById("search")!)!.keykeeperSelectors).toBeUndefined();
  });

  it("asks nothing for a page without fields, and takes no answer as no rules", async () => {
    await marker().mark(new Map());
    expect(asked).toEqual([]);

    const fields = collected();
    answer = null;
    await marker().mark(fields);
    expect([...fields.values()].some((f) => f.keykeeperSelectors)).toBe(false);
  });
});

describe("Upstream's field collection, with the hook", () => {
  const answers: Record<string, unknown> = {};

  beforeEach(() => {
    window.IntersectionObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    })) as unknown as typeof IntersectionObserver;
    globalThis.requestIdleCallback = jest.fn((cb) => setTimeout(cb, 0)) as never;
    globalThis.cancelIdleCallback = jest.fn((id) => clearTimeout(id));
    // Upstream's content script asks with chrome.runtime.sendMessage; the
    // test setup's stand-in never answers, so this one does.
    jest
      .mocked(chrome.runtime.sendMessage)
      .mockImplementation(((message: { command: string }, answer?: (response: unknown) => void) =>
        answer?.(answers[message.command] ?? { result: null })) as never);
    document.body.innerHTML = `
      <signin-box id="signin-box"></signin-box>
    `;
    document.getElementById("signin-box")!.attachShadow({ mode: "open" }).innerHTML = `
      <form><input id="secret" type="password" /><input id="member-number" type="text" /></form>`;
  });

  afterEach(() => {
    jest.mocked(chrome.runtime.sendMessage).mockReset();
    document.body.innerHTML = "";
  });

  it("marks the fields it collected inside a shadow root, and nothing else changes", async () => {
    const collect = () =>
      new CollectAutofillContentService(new DomElementVisibilityService(), new DomQueryService());

    answers[SITE_RULE_SELECTORS] = { result: [] };
    const without = await collect().getPageDetails();
    answers[SITE_RULE_SELECTORS] = { result: ["#signin-box >>> #member-number"] };
    const withRules = await collect().getPageDetails();

    const byId = (details: { fields: AutofillField[] }) =>
      Object.fromEntries(details.fields.map((f) => [f.htmlID, f]));
    expect(byId(withRules)["member-number"].keykeeperSelectors).toEqual([
      "#signin-box >>> #member-number",
    ]);
    expect(byId(withRules)["secret"].keykeeperSelectors).toBeUndefined();
    // The same fields otherwise, and none of them a targeted (Fill Assist) field.
    const member = { ...byId(withRules)["member-number"] };
    delete member.keykeeperSelectors;
    expect(member).toEqual(byId(without)["member-number"]);
    expect(withRules.fields.some((f: AutofillField) => f.targeted)).toBe(false);
  });
});
