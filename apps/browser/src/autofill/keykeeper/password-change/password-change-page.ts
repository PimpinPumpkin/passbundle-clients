// Keykeeper: what a page says during an assisted password change (DESIGN.md,
// "Assisted password change", "Telling whether it worked"): a CAPTCHA, a
// message that the password changed, an error, a message to check email,
// and which button submits the form. Plain DOM reads, so they're tested with
// a page of their own (password-change-page.spec.ts). Success needs a
// positive sign; a form that goes away proves nothing.

import type { RecipeSign } from "@bitwarden/common/tools/keykeeper/password-change-recipes";

import { SubmitChangePasswordButtonNames } from "../../services/autofill-constants";
import { getSubmitButtonKeywordsSet } from "../../utils/qualification";

/** Text a person sees in an element: rendered text where the browser has it. */
function textOf(element: Element): string {
  const html = element as HTMLElement;
  const text = typeof html.innerText === "string" ? html.innerText : element.textContent;
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Whether an element takes up room on the page (not display: none, not hidden). */
export function isShown(element: Element): boolean {
  const html = element as HTMLElement;
  if (html.hidden || element.closest("[hidden], [aria-hidden='true']") != null) {
    return false;
  }
  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle(element);
  return style == null || (style.display !== "none" && style.visibility !== "hidden");
}

const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();

/**
 * A CAPTCHA, or a check that the person isn't a robot, anywhere in the page:
 * the usual widgets' markers, and anything called a captcha. Shown or not,
 * since an invisible one can ask on submit. PassBundle never solves or
 * bypasses one; the person does.
 */
export function hasCaptcha(doc: Document): boolean {
  if (
    doc.querySelector(
      ".g-recaptcha, .grecaptcha-badge, .h-captcha, .cf-turnstile, [data-sitekey], [data-hcaptcha-widget-id]",
    ) != null
  ) {
    return true;
  }
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    const src = lower(frame.getAttribute("src"));
    const title = lower(frame.getAttribute("title"));
    if (
      /captcha|turnstile|challenges\.cloudflare\.com|arkoselabs|funcaptcha/.test(src + " " + title)
    ) {
      return true;
    }
  }
  for (const element of Array.from(doc.querySelectorAll("[id], [name], [class]"))) {
    const words = [element.id, element.getAttribute("name"), element.getAttribute("class")]
      .map(lower)
      .join(" ");
    if (words.includes("captcha")) {
      return true;
    }
  }
  return /\b(i'?m|i am) not a robot\b/i.test(textOf(doc.body ?? doc.documentElement));
}

/** Where a page says how things went: status and alert regions, headings, and message boxes. */
const MESSAGE_PLACES = [
  "[role='status']",
  "[role='alert']",
  "[aria-live]",
  "h1",
  "h2",
  "h3",
  "[class*='success' i]",
  "[class*='notice' i]",
  "[class*='flash' i]",
  "[class*='toast' i]",
  "[class*='message' i]",
].join(", ");

/** Words that say the password changed. English only, for now. */
const CHANGED = [
  /\bpassword\b[^.!?\n]{0,30}\b(changed|updated|saved)\b/i,
  /\b(changed|updated|saved)\b[^.!?\n]{0,20}\bpassword\b/i,
  /\bpassword change\b[^.!?\n]{0,10}\bsuccess(ful)?\b/i,
];

/** Words that say to look for an email or a text message to finish. */
const CONFIRM_BY_MESSAGE = [
  /\b(check|open) your (email|inbox|phone|messages)\b/i,
  /\bwe('ve| have)? (just )?sent (you )?(an? )?(email|text|message|link|code)\b/i,
  /\b(confirmation|verification) (email|link|message)\b/i,
];

const count = (texts: string[], patterns: RegExp[]) =>
  texts.reduce((n, text) => n + patterns.filter((p) => p.test(text)).length, 0);

function messageTexts(doc: Document): string[] {
  return Array.from(doc.querySelectorAll(MESSAGE_PLACES))
    .filter(isShown)
    .map(textOf)
    .filter((t) => t !== "" && t.length < 500);
}

/** How many times the page says the password changed. Compared before and after a press. */
export function changedMessages(doc: Document): number {
  return count(messageTexts(doc), CHANGED);
}

/** How many times the page says to check email or a phone. */
export function confirmMessages(doc: Document): number {
  return count([textOf(doc.body ?? doc.documentElement)], CONFIRM_BY_MESSAGE);
}

/** Where a page shows an error: alert regions and anything styled as an error. */
const ERROR_PLACES = [
  "[role='alert']",
  "[aria-live='assertive']",
  "[class*='error' i]",
  "[class*='invalid' i]",
  "[class*='danger' i]",
  "[id*='error' i]",
].join(", ");

/** The errors the page shows: shown elements with text that isn't a message that it worked. */
export function errorMessages(doc: Document): string[] {
  return Array.from(doc.querySelectorAll(ERROR_PLACES))
    .filter(isShown)
    .map(textOf)
    .filter((t) => t !== "" && t.length < 500 && count([t], CHANGED) === 0);
}

/** Whether any of these fields says it's invalid, as the page marks it. */
export function anyMarkedInvalid(fields: (Element | null | undefined)[]): boolean {
  return fields.some((f) => f != null && lower(f.getAttribute("aria-invalid")) === "true");
}

/** Whether the browser's own validation turns down any of these fields (a pattern, a length, required). */
export function anyFailsValidation(fields: (Element | null | undefined)[]): boolean {
  return fields.some((f) => {
    const input = f as HTMLInputElement | null | undefined;
    return input?.validity != null && input.validity.valid === false;
  });
}

/** Whether the rest of a form (anything but these fields) would stop the browser submitting it. */
export function restOfFormInvalid(form: HTMLFormElement | null, ours: Element[]): boolean {
  if (form == null) {
    return false;
  }
  return Array.from(form.elements).some((element) => {
    const input = element as HTMLInputElement;
    return (
      !ours.includes(element) &&
      input.willValidate === true &&
      input.validity != null &&
      input.validity.valid === false
    );
  });
}

/** Words a button says that make it never the one that saves the password. */
const NOT_SUBMIT = new Set([
  "cancel",
  "back",
  "show",
  "hide",
  "reveal",
  "toggle",
  "generate",
  "close",
  "forgot",
  "delete",
  "remove",
  "logout",
  "signout",
]);

/** What a button says to a person (its text, value, label, and title), as words. Not its classes. */
function saidWords(element: Element): string[] {
  const said = [
    textOf(element),
    element.getAttribute("value"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
  ].join(" ");
  return lower(said.replace(/sign\s+out/gi, "signout").replace(/log\s+out/gi, "logout"))
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}
/** Words that say a button saves the password: upstream's, plus a few more. */
const SUBMIT_WORDS = [...SubmitChangePasswordButtonNames, "update", "submit", "confirm", "set"];

const BUTTONS = "button, input[type='submit'], input[type='button'], [role='button']";

function isUsableButton(element: Element): boolean {
  const button = element as HTMLButtonElement;
  return (
    isShown(element) &&
    button.disabled !== true &&
    lower(element.getAttribute("aria-disabled")) !== "true"
  );
}

function isSubmitType(element: Element): boolean {
  if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
    return element.type === "submit";
  }
  return false;
}

/** The one button among these that submits, or null when it isn't clear which. */
function pickSubmit(buttons: Element[]): HTMLElement | null {
  const usable = buttons
    .filter(isUsableButton)
    .filter((b) => !saidWords(b).some((w) => NOT_SUBMIT.has(w)));
  const submits = usable.filter(isSubmitType);
  if (submits.length === 1) {
    return submits[0] as HTMLElement;
  }
  const pool = submits.length > 1 ? submits : usable;
  const worded = pool.filter((b) => {
    const words = Array.from(getSubmitButtonKeywordsSet(b as HTMLElement)).join(",");
    return SUBMIT_WORDS.some((w) => words.includes(w));
  });
  return worded.length === 1 ? (worded[0] as HTMLElement) : null;
}

/**
 * The button that submits the change-password form: in its form, the only
 * submit button, or the only button whose words say it saves (change, save,
 * update, submit, confirm, set). Fields outside a form look upward from the
 * new-password field to the first element with buttons, as auto-submit does.
 * Null when it isn't clear: the person presses it then.
 */
export function findSubmitButton(
  form: HTMLFormElement | null,
  newField: Element,
): HTMLElement | null {
  if (form != null) {
    return pickSubmit(Array.from(form.querySelectorAll(BUTTONS)));
  }
  let scope: Element | null = newField.parentElement;
  while (scope != null && scope.tagName !== "BODY" && scope.tagName !== "HTML") {
    const buttons = Array.from(scope.querySelectorAll(BUTTONS));
    if (buttons.length > 0) {
      return pickSubmit(buttons);
    }
    scope = scope.parentElement;
  }
  return null;
}

/** Whether a recipe's sign is on the page now: its element shown, its text in the page, or the tab at its path. */
export function signShown(doc: Document, sign: RecipeSign | null | undefined): boolean {
  if (sign == null) {
    return false;
  }
  if (sign.path != null && doc.location?.pathname === sign.path) {
    return true;
  }
  if (sign.selector != null) {
    try {
      const element = doc.querySelector(sign.selector);
      if (element != null && isShown(element)) {
        return true;
      }
    } catch {
      // A selector the browser can't read matches nothing.
    }
  }
  if (sign.text != null) {
    return textOf(doc.body ?? doc.documentElement)
      .toLowerCase()
      .includes(sign.text.toLowerCase());
  }
  return false;
}

/** The element a recipe's selector names, shown, or null. */
export function recipeElement(doc: Document, selector: string | null | undefined): Element | null {
  if (selector == null) {
    return null;
  }
  try {
    const element = doc.querySelector(selector);
    return element != null && isShown(element) ? element : null;
  } catch {
    return null;
  }
}
