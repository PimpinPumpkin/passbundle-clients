// Keykeeper: the page's half of an assisted password change (DESIGN.md,
// "Assisted password change"). The background injects it into the top frame
// of the one tab it opened for the change, and drives every step: it reads
// the page, presses a recipe's step, fills the form (and presses its button
// when told to), watches for the result, and shows a note. It answers only
// requests for the address it's at, so a page that moved on gets nothing, and
// it never sends the background anything on its own. The fields are found
// and filled with upstream's own collection and fill code, as autofill does.

import { PasswordChangeRecipe } from "@bitwarden/common/tools/keykeeper/password-change-recipes";
import { FieldPasswordRules } from "@bitwarden/common/tools/keykeeper/password-rules";

import AutofillField from "../../models/autofill-field";
import AutofillScript from "../../models/autofill-script";
import { isOneTimeCodeField } from "../one-time-code-fields";

import { ChangeFormPlan, findChangePasswordForm, FormReading } from "./password-change-form";
import {
  FillAnswer,
  FillRequest,
  Mismatch,
  NoteRequest,
  PAGE_FILL,
  PAGE_NOTE,
  PAGE_READ,
  PAGE_STEP,
  PAGE_WATCH,
  PageReading,
  ReadRequest,
  StepRequest,
  WatchRequest,
} from "./password-change-messages";
import {
  anyFailsValidation,
  anyMarkedInvalid,
  changedMessages,
  confirmMessages,
  errorMessages,
  findSubmitButton,
  hasCaptcha,
  isShown,
  recipeElement,
  restOfFormInvalid,
  signShown,
} from "./password-change-page";

/** What the content script needs of upstream's collection and fill. */
export type PageServices = {
  collect: {
    getPageDetails(): Promise<{ fields: AutofillField[] }>;
    getAutofillFieldElementByOpid(opid: string): Element | null;
    /** Forgets what it found, so the next read walks the page again. */
    stopMonitoring?(): void;
  };
  insert: { fillForm(script: AutofillScript): Promise<void> };
};

/** The form found on this page, with its elements. */
type Plan = ChangeFormPlan & {
  formElement: HTMLFormElement | null;
  currentElement: HTMLInputElement | null;
  newElement: HTMLInputElement;
  confirmElement: HTMLInputElement | null;
};

/** How long a page that dropped its form gets to show a message about it. */
const SETTLE_MS = 2_000;
/** How often the page is looked at again while watching, besides on every change. */
const LOOK_MS = 250;

const isPasswordInput = (element: Element | null): element is HTMLInputElement =>
  element instanceof HTMLInputElement && element.type === "password";

/** Whether an element has a size on the page: a field 0 by 0 is a hidden one. */
export const hasSize = (element: Element): boolean => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
};

/** A one-time code field shown anywhere on the page, as upstream's code check reads one. */
function codeFieldShown(doc: Document, ours: Element[], shown: (e: Element) => boolean): boolean {
  for (const input of Array.from(doc.querySelectorAll("input"))) {
    if (ours.includes(input) || !shown(input)) {
      continue;
    }
    if (!["text", "tel", "number", "password", ""].includes(input.type)) {
      continue;
    }
    const field = {
      htmlID: input.id,
      htmlName: input.name,
      placeholder: input.placeholder,
      title: input.title,
      autoCompleteType: input.getAttribute("autocomplete"),
      "label-aria": input.getAttribute("aria-label"),
      "label-tag": Array.from(input.labels ?? [])
        .map((l) => l.textContent ?? "")
        .join(" "),
    } as unknown as AutofillField;
    if (/one-time-code/i.test(field.autoCompleteType ?? "") || isOneTimeCodeField(field)) {
      return true;
    }
  }
  return false;
}

export class PasswordChangeContent {
  private services: PageServices | null = null;
  private plan: Plan | null = null;
  /** What the page said at the fill: only what appears after counts. */
  private baseline: {
    changed: number;
    confirm: number;
    errors: Set<string>;
    code: boolean;
    captcha: boolean;
    invalid: boolean;
  } | null = null;
  private noteHost: HTMLElement | null = null;
  private noteTitle: HTMLElement | null = null;
  private noteText: HTMLElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly makeServices: () => PageServices,
    private readonly setFilling: (filling: boolean) => void = () => {},
    private readonly sized: (element: Element) => boolean = hasSize,
  ) {}

  /** Whether a field takes up room on the page. Upstream's "viewable" also needs it in view and not under anything. */
  private shown = (element: Element): boolean => isShown(element) && this.sized(element);

  /** Handles a request from the background, or answers null for anything else. */
  handle(message: unknown): Promise<unknown> | null {
    const command = (message as { command?: unknown } | null)?.command;
    switch (command) {
      case PAGE_READ:
        return this.read(message as ReadRequest);
      case PAGE_STEP:
        return this.step(message as StepRequest);
      case PAGE_FILL:
        return this.fill(message as FillRequest);
      case PAGE_WATCH:
        return this.watch(message as WatchRequest);
      case PAGE_NOTE:
        return Promise.resolve(this.showNote(message as NoteRequest));
      default:
        return null;
    }
  }

  private get url(): string {
    return this.doc.defaultView?.location.href ?? "";
  }

  private mismatch(url: unknown): Mismatch | null {
    return url === this.url ? null : { url: this.url, mismatch: true };
  }

  /** Reads the page for its change-password form and what else it says. */
  async read(request: ReadRequest): Promise<PageReading | Mismatch> {
    const moved = this.mismatch(request.url);
    if (moved) {
      return moved;
    }
    // Upstream's collection keeps what it found until its own observer, which
    // isn't running here, says the page changed: it forgets first.
    this.services ??= this.makeServices();
    this.services.collect.stopMonitoring?.();
    const details = await this.services.collect.getPageDetails();
    const fields = details.fields.map((field) => {
      const element = this.services!.collect.getAutofillFieldElementByOpid(field.opid);
      // Upstream's "viewable" also needs a field in view and not under
      // anything (a note of ours, say); a form lower on the page counts here.
      return { ...field, viewable: element != null && this.shown(element) };
    });
    const found = this.recipeForm(request.recipe, fields) ?? findChangePasswordForm(fields);
    if (found.kind === "form") {
      this.plan = this.planFor(found.plan);
    } else {
      this.plan = null;
    }
    return this.reading(request.recipe, request.step, found);
  }

  /** The form as a recipe names its fields, when it does. */
  private recipeForm(
    recipe: PasswordChangeRecipe | null,
    fields: AutofillField[],
  ): FormReading | null {
    const named = recipe?.fields;
    if (named?.new == null) {
      return null;
    }
    const opidOf = (selector: string | null | undefined): string | null | undefined => {
      if (selector === null) {
        return null;
      }
      const element = recipeElement(this.doc, selector);
      if (!isPasswordInput(element)) {
        return undefined;
      }
      return fields.find(
        (f) => this.services!.collect.getAutofillFieldElementByOpid(f.opid) === element,
      )?.opid;
    };
    const next = opidOf(named.new);
    const current = named.current === undefined ? undefined : opidOf(named.current);
    const confirm = named.confirm == null ? null : opidOf(named.confirm);
    if (next == null || current === undefined || confirm === undefined) {
      return { kind: "none" };
    }
    const form = fields.find((f) => f.opid === next)?.form ?? null;
    return {
      kind: "form",
      plan: { form, current, new: next, confirm },
      codeField: false,
    };
  }

  private planFor(plan: ChangeFormPlan): Plan | null {
    const element = (opid: string | null) =>
      opid == null ? null : this.services!.collect.getAutofillFieldElementByOpid(opid);
    const newElement = element(plan.new);
    const currentElement = element(plan.current);
    const confirmElement = element(plan.confirm);
    if (
      !isPasswordInput(newElement) ||
      (plan.current != null && !isPasswordInput(currentElement)) ||
      (plan.confirm != null && !isPasswordInput(confirmElement))
    ) {
      return null;
    }
    return {
      ...plan,
      formElement: newElement.form,
      newElement,
      currentElement: currentElement as HTMLInputElement | null,
      confirmElement: confirmElement as HTMLInputElement | null,
    };
  }

  private planElements(): HTMLInputElement[] {
    const plan = this.plan;
    if (plan == null) {
      return [];
    }
    return [plan.currentElement, plan.newElement, plan.confirmElement].filter(
      (e): e is HTMLInputElement => e != null,
    );
  }

  /** The plan's fields still on the page and shown: the form is still there. */
  private formStillThere(): boolean {
    const plan = this.plan;
    return plan != null && plan.newElement.isConnected && this.shown(plan.newElement);
  }

  private reading(
    recipe: PasswordChangeRecipe | null,
    step: number,
    found: FormReading,
  ): PageReading {
    const ours = this.planElements();
    const errors = errorMessages(this.doc);
    const baseline = this.baseline;
    const filledHere = baseline != null;
    const plan = this.plan;
    const fieldRules: FieldPasswordRules[] = [plan?.newElement, plan?.confirmElement]
      .filter((e): e is HTMLInputElement => e != null)
      .map((e) => ({
        passwordRules: e.getAttribute("passwordrules"),
        minLength: e.minLength,
        maxLength: e.maxLength,
      }));
    const submit =
      plan == null
        ? null
        : recipe?.submit != null
          ? recipeElement(this.doc, recipe.submit)
          : findSubmitButton(plan.formElement, plan.newElement);
    const nextStep = recipe?.steps?.[step];
    const code = codeFieldShown(this.doc, ours, this.shown);
    const captcha = hasCaptcha(this.doc);
    return {
      url: this.url,
      form: plan == null && found.kind === "form" ? "none" : found.kind,
      // Before the fill, a code field in the form; after it, one that wasn't there then.
      codeField:
        baseline != null
          ? code && !baseline.code
          : found.kind === "form" && plan != null
            ? found.codeField
            : code,
      captcha: baseline != null ? captcha && !baseline.captcha : captcha,
      confirmMessage: confirmMessages(this.doc) > (baseline?.confirm ?? 0),
      changedMessage: changedMessages(this.doc) > (baseline?.changed ?? 0),
      errorMessage: errors.some((e) => !(baseline?.errors.has(e) ?? false)),
      invalidField: anyMarkedInvalid(ours) && !(baseline?.invalid ?? false),
      recipeChanged: signShown(this.doc, recipe?.changed),
      recipeRefused: signShown(this.doc, recipe?.refused),
      rules: fieldRules,
      submitButton: submit != null,
      stepReady: nextStep != null && recipeElement(this.doc, nextStep) != null,
      filledHere,
    };
  }

  /** Presses a recipe's step, if it's on the page. */
  async step(request: StepRequest): Promise<{ clicked: boolean } | Mismatch> {
    const moved = this.mismatch(request.url);
    if (moved) {
      return moved;
    }
    const element = recipeElement(this.doc, request.recipe?.steps?.[request.step]);
    if (!(element instanceof HTMLElement)) {
      return { clicked: false };
    }
    element.click();
    return { clicked: true };
  }

  /**
   * Fills the form found at the last read, reads the values back, and checks
   * the browser's own validation. Presses the button only when told to, and
   * only when everything took and nothing in the form stops it.
   */
  async fill(request: FillRequest): Promise<FillAnswer | Mismatch> {
    const moved = this.mismatch(request.url);
    if (moved) {
      return moved;
    }
    const nothing: FillAnswer = {
      url: this.url,
      filled: false,
      invalid: false,
      restInvalid: false,
      submitted: false,
    };
    const plan = this.plan;
    if (plan == null || this.services == null || !this.formStillThere()) {
      return nothing;
    }
    const script = new AutofillScript();
    if (plan.current != null) {
      script.script.push(["fill_by_opid", plan.current, request.current]);
    }
    script.script.push(["fill_by_opid", plan.new, request.next]);
    if (plan.confirm != null) {
      script.script.push(["fill_by_opid", plan.confirm, request.next]);
    }
    script.untrustedIframe = false;
    this.setFilling(true);
    try {
      await this.services.insert.fillForm(script);
    } finally {
      this.setFilling(false);
    }
    const filled =
      (plan.currentElement == null || plan.currentElement.value === request.current) &&
      plan.newElement.value === request.next &&
      (plan.confirmElement == null || plan.confirmElement.value === request.next);
    const ours = this.planElements();
    this.baseline = {
      changed: changedMessages(this.doc),
      confirm: confirmMessages(this.doc),
      errors: new Set(errorMessages(this.doc)),
      code: codeFieldShown(this.doc, ours, this.shown),
      captcha: hasCaptcha(this.doc),
      invalid: anyMarkedInvalid(ours),
    };
    const invalid = anyFailsValidation(ours);
    const restInvalid = restOfFormInvalid(plan.formElement, ours);
    let submitted = false;
    if (request.submit && filled && !invalid && !restInvalid) {
      const button =
        request.recipe?.submit != null
          ? recipeElement(this.doc, request.recipe.submit)
          : findSubmitButton(plan.formElement, plan.newElement);
      if (button instanceof HTMLElement) {
        button.click();
        submitted = true;
      }
    }
    return { url: this.url, filled, invalid, restInvalid, submitted };
  }

  /**
   * Watches the page for up to `ms` for a result: a message that it changed,
   * an error, a field marked invalid, a CAPTCHA, a code to enter, a message
   * to check email, or a recipe's sign. A form that goes away gets a moment
   * to say why. Answers what the page says then. A page the site replaces
   * ends this script, and the background reads the next one.
   */
  async watch(request: WatchRequest): Promise<PageReading | Mismatch> {
    const moved = this.mismatch(request.url);
    if (moved) {
      return moved;
    }
    const found: FormReading =
      this.plan != null ? { kind: "form", plan: this.plan, codeField: false } : { kind: "none" };
    const look = () =>
      this.reading(request.recipe, 0, this.formStillThere() ? found : { kind: "none" });
    const decisive = (r: PageReading) =>
      r.changedMessage ||
      r.errorMessage ||
      r.invalidField ||
      r.captcha ||
      r.codeField ||
      r.confirmMessage ||
      r.recipeChanged ||
      r.recipeRefused;
    return new Promise((resolve) => {
      const view = this.doc.defaultView!;
      let settle: number | null = null;
      let done = false;
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        observer.disconnect();
        view.clearInterval(interval);
        view.clearTimeout(limit);
        if (settle != null) {
          view.clearTimeout(settle);
        }
        resolve(look());
      };
      const check = () => {
        if (done) {
          return;
        }
        if (decisive(look())) {
          return finish();
        }
        if (!this.formStillThere() && settle == null) {
          settle = view.setTimeout(finish, SETTLE_MS);
        }
      };
      const observer = new view.MutationObserver(check);
      observer.observe(this.doc.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      const interval = view.setInterval(check, LOOK_MS);
      const limit = view.setTimeout(finish, Math.max(0, Math.min(request.ms, 10 * 60_000)));
      check();
    });
  }

  /**
   * A short note on the page saying what's happening and what to do next.
   * Text only, in a closed shadow root, with no buttons: a page can't trick a
   * click into it, and decisions are made in the extension's own pages.
   */
  showNote(request: NoteRequest): { shown: boolean } {
    if (request.text == null) {
      this.noteHost?.remove();
      this.noteHost = null;
      return { shown: false };
    }
    if (this.noteHost == null || !this.noteHost.isConnected) {
      const host = this.doc.createElement("div");
      host.setAttribute(
        "style",
        "all: initial; position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;",
      );
      const shadow = host.attachShadow({ mode: "closed" });
      const style = this.doc.createElement("style");
      style.textContent = `
        .note { box-sizing: border-box; max-width: 320px; padding: 12px 14px; border-radius: 10px;
          background: #ffffff; color: #1f2328; border: 1px solid #c8ccd1;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
          font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .title { display: block; font-weight: 600; margin-bottom: 4px; }
        .text { margin: 0; }
        @media (prefers-color-scheme: dark) {
          .note { background: #24292f; color: #f0f3f6; border-color: #4a5058; }
        }`;
      const note = this.doc.createElement("div");
      note.className = "note";
      note.setAttribute("role", "status");
      note.setAttribute("aria-live", "polite");
      const title = this.doc.createElement("strong");
      title.className = "title";
      const text = this.doc.createElement("p");
      text.className = "text";
      note.append(title, text);
      shadow.append(style, note);
      (this.doc.body ?? this.doc.documentElement).appendChild(host);
      this.noteHost = host;
      this.noteTitle = title;
      this.noteText = text;
    }
    this.noteTitle!.textContent = request.title;
    this.noteText!.textContent = request.text;
    return { shown: true };
  }
}
