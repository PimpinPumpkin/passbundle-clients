// Keykeeper: the messages of an assisted password change (DESIGN.md,
// "Assisted password change"), in a file of their own so the popup and the
// content script don't load the background's code to send them.

import type { PasswordChangeRecipe } from "@bitwarden/common/tools/keykeeper/password-change-recipes";
import type { FieldPasswordRules } from "@bitwarden/common/tools/keykeeper/password-rules";

/** An extension page asks the background to start a change: the item's id, and whether it asked for the master password. */
export const PASSWORD_CHANGE_START = "keykeeperPasswordChangeStart";
/** An extension page asks whether a change for an item is running in this browser. */
export const PASSWORD_CHANGE_STATUS = "keykeeperPasswordChangeStatus";

/** The background asks the content script in the tab's page: what's on the page? */
export const PAGE_READ = "keykeeperPasswordChangeRead";
/** The background asks the content script to press a recipe's next step. */
export const PAGE_STEP = "keykeeperPasswordChangeStep";
/** The background asks the content script to fill the form, and to press its button when `submit`. */
export const PAGE_FILL = "keykeeperPasswordChangeFill";
/** The background asks the content script to watch the page for a result. */
export const PAGE_WATCH = "keykeeperPasswordChangeWatch";
/** The background asks the content script to show a note on the page, or (no text) take it away. */
export const PAGE_NOTE = "keykeeperPasswordChangeNote";

/** The content script's file, as the build names it. */
export const PASSWORD_CHANGE_SCRIPT = "content/keykeeper-password-change.js";

/** Why the background couldn't start a change, for the popup to say. */
export type StartRefusal = "running" | "notAllowed" | "noWebsite" | "locked" | "reprompt";

export type StartAnswer = { started: true } | { started: false; reason: StartRefusal };

/** What the content script read on the page. */
export type PageReading = {
  /** The page's address: the background acts only if it's the one it checked. */
  url: string;
  /** The change-password form, as generic mode or the recipe found it. */
  form: "form" | "noCurrent" | "ambiguous" | "signIn" | "none";
  /** A one-time code field: in the form when there is one, otherwise anywhere on the page. */
  codeField: boolean;
  captcha: boolean;
  /** The page asks the person to check email or a phone. */
  confirmMessage: boolean;
  /** A message that the password changed, new since the fill on this page (any, on a page that came after). */
  changedMessage: boolean;
  /** An error near the form, new since the fill (any, on a page that came after). */
  errorMessage: boolean;
  /** One of the form's fields is marked invalid, or the browser's own validation turns it down. */
  invalidField: boolean;
  /** The recipe's sign that it worked, or that it was refused. */
  recipeChanged: boolean;
  recipeRefused: boolean;
  /** The form's new and confirm fields' own rules. */
  rules: FieldPasswordRules[];
  /** Whether the form has a button that clearly submits it. */
  submitButton: boolean;
  /** Whether the recipe's next step is on the page. */
  stepReady: boolean;
  /** Whether this is the page that was filled, rather than one that came after. */
  filledHere: boolean;
};

export type ReadRequest = {
  command: typeof PAGE_READ;
  url: string;
  recipe: PasswordChangeRecipe | null;
  step: number;
};

export type StepRequest = {
  command: typeof PAGE_STEP;
  url: string;
  recipe: PasswordChangeRecipe | null;
  step: number;
};

export type FillRequest = {
  command: typeof PAGE_FILL;
  url: string;
  current: string;
  next: string;
  submit: boolean;
  recipe: PasswordChangeRecipe | null;
};

export type FillAnswer = {
  url: string;
  /** Every field took its value and kept it. */
  filled: boolean;
  /** The form's own rules turned the values down (a pattern, a length). */
  invalid: boolean;
  /** Something else in the form must be filled first (a required field, a box to tick). */
  restInvalid: boolean;
  /** The button was pressed. */
  submitted: boolean;
};

export type WatchRequest = {
  command: typeof PAGE_WATCH;
  url: string;
  ms: number;
  recipe: PasswordChangeRecipe | null;
};

export type NoteRequest = { command: typeof PAGE_NOTE; title: string; text: string | null };

/** The page's answer to a request for another address: it moved on. */
export type Mismatch = { url: string; mismatch: true };
