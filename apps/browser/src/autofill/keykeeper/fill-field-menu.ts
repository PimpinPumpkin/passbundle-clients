// Keykeeper fill picker: right-click any field, then "Fill this field with",
// an item, and one of its values (or "Never fill this field", or "Never fill
// this field on this site" for every item). It fills the field now and saves
// the choice as a fill rule on the item (fill-rules.ts), or in the person's
// own settings for a site-wide never-fill (site-never-fill.ts), so every
// later autofill on that site does the same. Logins, cards, and identities
// each offer their values. An item that asks for the master password asks
// first, for any choice, and nothing fills or is saved unless the prompt
// succeeds.

import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { ROOT_ID } from "@bitwarden/common/autofill/constants";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import {
  CARD_FILL_VALUES,
  CARD_VALUE_WORDS,
  IDENTITY_FILL_VALUES,
  IDENTITY_VALUE_WORDS,
} from "@bitwarden/common/vault/keykeeper/fill-rules";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { BrowserApi } from "../../platform/browser/browser-api";
import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import AutofillScript from "../models/autofill-script";
import { AutofillTriageResponse } from "../types/autofill-triage";

import { cardMayFillFrame, isPagesOwnSite } from "./card-frames";
import {
  decidingFingerprint,
  fieldMatches,
  fieldValueFor,
  FillRule,
  FillSource,
  fingerprintField,
  hostOf,
  isSecretSource,
  keykeeperSiteFixes,
  keykeeperSiteNeverFill,
  readFillRules,
  ruleAppliesOn,
  schemeOfUrl,
  upsertFillRule,
  visibleCustomFields,
} from "./fill-rules";
import { noteFill } from "./hidden-fills";
import { confidentLabelMatch, labelText } from "./label-match";

// No underscores: menu ids are split on "_".
export const FILL_FIELD_ID = "kkfill";

export { FILL_FIELD_REPROMPT_ACTION, FILL_FIELD_REPROMPTED } from "./fill-field-reprompt";

/**
 * What the picker asks of the background, set by main.background: whether an
 * item is for a page, by its websites and the person's match settings, as
 * upstream's autofill decides it; whether its two-step code shows, which
 * needs Premium or an organization that gives codes (two-step-codes.ts), as
 * autofill decides it; and whether upstream's autofill leaves a field alone
 * (`AutofillService.isExcludedFromFillRules`: search boxes, captchas,
 * newsletter forms, the field types it never fills). Until then, nothing is
 * for any page, no code is offered, and every field is left alone.
 */
export const keykeeperFillPicker = {
  itemMatches: async (_cipher: CipherView, _url: string): Promise<boolean> => false,
  showsTotp: async (_cipher: CipherView): Promise<boolean> => false,
  excluded: (_field: AutofillField, _pageDetails: AutofillPageDetails): boolean => true,
};

/**
 * The menu's words, by message key: ours from brand/messages.en.json, and
 * upstream's own for the values, which come translated. Here in English for
 * a build without our strings (and tests). `$1` is where a name goes.
 */
const ENGLISH = {
  keykeeperFillThisFieldWith: "Fill this field with",
  username: "Username",
  password: "Password",
  verificationCode: "Verification code",
  keykeeperNeverFillThisField: "Never fill this field",
  keykeeperNeverFillThisFieldOnThisSite: "Never fill this field on this site",
  keykeeperFillHere: "Fill $1 here?",
  cardholderName: "Cardholder name",
  number: "Number",
  expirationMonth: "Expiration month",
  expirationYear: "Expiration year",
  securityCode: "Security code",
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  fullName: "Full name",
  company: "Company",
  email: "Email",
  phone: "Phone",
  address1: "Address 1",
  address2: "Address 2",
  address3: "Address 3",
  cityTown: "City / Town",
  stateProvince: "State / Province",
  zipPostalCode: "Zip / Postal code",
  country: "Country",
};

export type FillPickerWord = keyof typeof ENGLISH;

/** Gives the menu's words, with a name where the word has a place for one. */
export type FillPickerWords = (word: FillPickerWord, ...names: string[]) => string;

/** The menu's words in English. */
export const englishFillPickerWords: FillPickerWords = (word, ...names) =>
  ENGLISH[word].replace(/\$(\d)/g, (_, n: string) => names[Number(n) - 1] ?? "");

/**
 * The menu's words in the person's language, English for any word that
 * isn't translated yet. Our own strings are English in every language for now.
 */
export function fillPickerWords(i18n: Pick<I18nService, "t">): FillPickerWords {
  return (word, ...names) =>
    i18n.t(word, ...(names as [string?, string?, string?])) ||
    englishFillPickerWords(word, ...names);
}

export type FillChoice = {
  key: string;
  title: string;
  source: FillSource;
  /** "Never fill this field on this site": for every item, kept in the person's settings. */
  siteWide?: boolean;
};

/** The item kinds the picker offers values of. */
const PICKED_TYPES: ReadonlySet<CipherType> = new Set([
  CipherType.Login,
  CipherType.Card,
  CipherType.Identity,
]);

/**
 * What an item can fill into a field, in menu order, named in `words`: a
 * login's username, password, and two-step code (only where `codes` says it
 * shows, `keykeeperFillPicker.showsTotp`); a card's name, number, expiry
 * month and year, and security code; an identity's names, company, email,
 * phone, and address; then the item's custom fields, and the two never-fills.
 * Someone who can't see the item's secrets isn't offered them: a login's
 * password, a card's number and code, hidden fields.
 */
export function choicesFor(
  cipher: CipherView,
  words: FillPickerWords = englishFillPickerWords,
  codes = false,
): FillChoice[] {
  const choices: FillChoice[] = [];
  const maySee = maySeeSecrets(cipher);
  if (cipher.type !== CipherType.Card && cipher.type !== CipherType.Identity) {
    if (cipher.login?.username) {
      choices.push({ key: "u", title: words("username"), source: { from: "username" } });
    }
    if (cipher.login?.password && maySee) {
      choices.push({ key: "p", title: words("password"), source: { from: "password" } });
    }
    if (cipher.login?.totp && codes) {
      choices.push({ key: "t", title: words("verificationCode"), source: { from: "totp" } });
    }
  }
  if (cipher.type === CipherType.Card) {
    CARD_FILL_VALUES.forEach((value, index) => {
      const source: FillSource = { from: "card", value };
      if (cipher.card?.[value] && (maySee || !isSecretSource(cipher, source))) {
        choices.push({
          key: `c${index}`,
          title: words(CARD_VALUE_WORDS[value] as FillPickerWord),
          source,
        });
      }
    });
  }
  if (cipher.type === CipherType.Identity) {
    IDENTITY_FILL_VALUES.forEach((value, index) => {
      const source: FillSource = { from: "identity", value };
      if (cipher.identity?.[value] && (maySee || !isSecretSource(cipher, source))) {
        choices.push({
          key: `i${index}`,
          title: words(IDENTITY_VALUE_WORDS[value] as FillPickerWord),
          source,
        });
      }
    });
  }
  visibleCustomFields(cipher).forEach((field, index) => {
    // Hidden fields stay hidden from someone who can't see the item's passwords.
    if (field.type === FieldType.Hidden && !maySeeSecrets(cipher)) {
      return;
    }
    if (field.name && field.type !== FieldType.Boolean && field.type !== FieldType.Linked) {
      choices.push({
        key: `f${index}`,
        title: field.name,
        source: { from: "field", name: field.name },
      });
    }
  });
  choices.push({
    key: "n",
    title: words("keykeeperNeverFillThisField"),
    source: { from: "never" },
  });
  choices.push({
    key: "s",
    title: words("keykeeperNeverFillThisFieldOnThisSite"),
    source: { from: "never" },
    siteWide: true,
  });
  return choices;
}

/** Field types a label suggestion fills: ones people type a value into. */
const TYPED_INTO = new Set(["text", "email", "tel", "number", "url", "password"]);

/**
 * Whether upstream's own matching fills a custom field into this field
 * anyway: the field's id, name, or one of its labels is the custom field's
 * name, without case (`AutofillService.findMatchingFieldIndex`). A name with
 * "=" is one of upstream's patterns ("regex=", "csv=", "id="): never a label.
 */
function upstreamFillsByName(field: AutofillField, name: string): boolean {
  if (name.includes("=")) {
    return true;
  }
  const wanted = name.toLowerCase();
  return [
    field.htmlID,
    field.htmlName,
    field["label-left"],
    field["label-right"],
    field["label-tag"],
    field["label-aria"],
    field.placeholder,
  ].some(
    (value) =>
      typeof value === "string" &&
      value
        .trim()
        .replace(/(?:\r\n|\r|\n)/g, "")
        .toLowerCase() === wanted,
  );
}

/**
 * The one-tap suggestion for the field the menu is in: a login's custom
 * field whose name is a confident match for the field's label
 * (label-match.ts), offered as "Fill Customer ID here?". It's the picker's
 * own choice for that custom field (the same key), so the tap fills and
 * remembers it through `fillFieldWith`; nothing fills before the tap. None
 * when the login isn't for the page or frame the field is in; when the field
 * is one upstream's autofill leaves alone, can't be seen, or isn't typed
 * into; when a rule of the login's, or the person's site-wide never-fill,
 * already decides the field; when upstream fills a custom field there by its
 * name anyway; or when more than one custom field matches. A hidden custom
 * field is suggested only to someone who can see the item's passwords, and
 * only for a password field.
 */
export async function labelSuggestion(
  cipher: CipherView,
  field: AutofillField,
  pageDetails: AutofillPageDetails,
  words: FillPickerWords = englishFillPickerWords,
): Promise<FillChoice | null> {
  const url = pageDetails.url;
  if (
    cipher.type !== CipherType.Login ||
    !field.viewable ||
    field.readonly ||
    field.disabled ||
    typeof field.type !== "string" ||
    !TYPED_INTO.has(field.type) ||
    keykeeperFillPicker.excluded(field, pageDetails)
  ) {
    return null;
  }
  const custom = visibleCustomFields(cipher);
  if (
    custom.length === 0 ||
    custom.some((f) => f.name != null && upstreamFillsByName(field, f.name))
  ) {
    return null;
  }
  const decided = [...(await keykeeperSiteNeverFill.rulesFor(url)), ...readFillRules(cipher)].some(
    (rule) =>
      (rule.host == null ? rule.fill.from === "never" : ruleAppliesOn(rule, url)) &&
      fieldMatches(rule.field, field),
  );
  if (decided) {
    return null;
  }
  const label = labelText(field);
  const matches = custom
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => {
      if (!f.name || !f.value || (f.type !== FieldType.Text && f.type !== FieldType.Hidden)) {
        return false;
      }
      if (f.type === FieldType.Hidden && (!maySeeSecrets(cipher) || field.type !== "password")) {
        return false;
      }
      return confidentLabelMatch(label, f.name);
    });
  if (matches.length !== 1 || !(await keykeeperFillPicker.itemMatches(cipher, url))) {
    return null;
  }
  const { f, index } = matches[0];
  const choice = choicesFor(cipher, words).find((c) => c.key === `f${index}`);
  return choice ? { ...choice, title: words("keykeeperFillHere", f.name ?? "") } : null;
}

/** Reads `kkfill_<cipherId>_<choiceKey>`. Cipher ids are GUIDs, without underscores. */
export function parseFillFieldMenuId(menuItemId: string): { cipherId: string; key: string } | null {
  const match = new RegExp(`^${FILL_FIELD_ID}_([^_]+)_([a-z][0-9]*)$`).exec(menuItemId);
  return match ? { cipherId: match[1], key: match[2] } : null;
}

const sanitizeTitle = (title: string) => title.replace(/&/g, "&&");

/** Creates a menu item, ignoring "already exists" so repeated updates are harmless. */
function create(options: chrome.contextMenus.CreateProperties): Promise<void> {
  if (!chrome.contextMenus) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    chrome.contextMenus.create({ contexts: ["editable"], ...options }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/** Menu ids created since the last reset, for tests and to skip duplicates. */
export const createdFillFieldMenuIds = new Set<string>();

export async function initFillFieldMenu(
  words: FillPickerWords = englishFillPickerWords,
): Promise<void> {
  createdFillFieldMenuIds.clear();
  await create({
    id: FILL_FIELD_ID,
    parentId: ROOT_ID,
    title: words("keykeeperFillThisFieldWith"),
  });
  createdFillFieldMenuIds.add(FILL_FIELD_ID);
}

/** Takes "Fill this field with" away, with every item under it: on a blocked domain, say. */
export async function removeFillFieldMenu(): Promise<void> {
  createdFillFieldMenuIds.clear();
  if (!chrome.contextMenus) {
    return;
  }
  await new Promise<void>((resolve) => {
    chrome.contextMenus.remove(FILL_FIELD_ID, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/** Adds an item (a login, a card, or an identity), with its values, under "Fill this field with". */
export async function addCipherToFillFieldMenu(
  cipher: CipherView | undefined,
  words: FillPickerWords = englishFillPickerWords,
): Promise<void> {
  if (!cipher?.id || !PICKED_TYPES.has(cipher.type)) {
    return;
  }
  const parentId = `${FILL_FIELD_ID}_${cipher.id}`;
  if (createdFillFieldMenuIds.has(parentId)) {
    return;
  }
  await create({ id: parentId, parentId: FILL_FIELD_ID, title: sanitizeTitle(cipher.name ?? "") });
  createdFillFieldMenuIds.add(parentId);
  const codes = cipher.type === CipherType.Login && (await keykeeperFillPicker.showsTotp(cipher));
  for (const choice of choicesFor(cipher, words, codes)) {
    if (choice.source.from === "never" && !choice.siteWide) {
      await create({ id: `${parentId}_separator`, parentId, type: "separator" });
    }
    const id = `${parentId}_${choice.key}`;
    await create({ id, parentId, title: sanitizeTitle(choice.title) });
    createdFillFieldMenuIds.add(id);
  }
}

export type FillFieldMenuDependencies = {
  authService: AuthService;
  accountService: AccountService;
  cipherService: CipherService;
  totpService: TotpService;
  /** Whether the item asks for the master password before anything of it is used. */
  passwordRepromptRequired: (cipher: CipherView) => Promise<boolean>;
  /**
   * Opens the master password prompt for a pick (FILL_FIELD_REPROMPT_ACTION),
   * whose answer comes back through `finishPickAfterReprompt`.
   */
  openReprompt: (tab: chrome.tabs.Tab, cipher: CipherView) => Promise<void>;
};

/** What filling a pick needs. */
export type PickDependencies = Pick<
  FillFieldMenuDependencies,
  "cipherService" | "totpService" | "passwordRepromptRequired" | "openReprompt"
>;

/**
 * Upstream's warning before filling an http page: whether the item has an
 * https website for this page's host. Upstream's page script used to work
 * this out from the item's websites; it now takes the answer.
 */
function requiresInsecurePageConfirmation(cipher: CipherView, pageUrl: string): boolean {
  let host: string;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "http:") {
      return false;
    }
    host = url.hostname;
  } catch {
    return false;
  }
  return (cipher.login?.uris ?? []).some(
    (u) =>
      u.match != UriMatchStrategy.Never && u.uri != null && u.uri.startsWith(`https://${host}`),
  );
}

/** Asks the page which field was right-clicked, with the page details it belongs to. */
async function rightClickedField(
  tab: chrome.tabs.Tab,
  frameId: number,
): Promise<{ field: AutofillField; url: string } | null> {
  const response = await BrowserApi.tabSendMessage<unknown, AutofillTriageResponse>(
    tab,
    { command: "collectAutofillTriage" },
    { frameId },
  );
  const field = response?.pageDetails?.fields.find((f) => f.opid === response.targetOpid);
  return field ? { field, url: response.pageDetails.url } : null;
}

/** Handles a click on one of our menu items. Returns true when it was ours. */
export async function handleFillFieldMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
  deps: FillFieldMenuDependencies,
): Promise<boolean> {
  const parsed = parseFillFieldMenuId(String(info.menuItemId));
  if (!parsed) {
    return String(info.menuItemId).startsWith(FILL_FIELD_ID);
  }
  if ((await deps.authService.getAuthStatus()) < AuthenticationStatus.Unlocked) {
    return true;
  }
  const userId = await firstValueFrom(deps.accountService.activeAccount$.pipe(getOptionalUserId));
  if (userId == null) {
    return true;
  }
  const cipher = (await deps.cipherService.getAllDecrypted(userId)).find(
    (c) => c.id === parsed.cipherId && PICKED_TYPES.has(c.type),
  );
  const choice = cipher
    ? choicesFor(cipher, undefined, await keykeeperFillPicker.showsTotp(cipher)).find(
        (c) => c.key === parsed.key,
      )
    : undefined;
  if (!cipher || !choice) {
    return true;
  }

  const frameId = info.frameId ?? 0;
  const target = await rightClickedField(tab, frameId);
  if (!target) {
    return true;
  }
  await fillFieldWith({ tab, frameId, target, cipher, choice, userId }, deps);
  return true;
}

/** Where a choice fills: the tab, the frame, and the field there. */
export type FillFieldTarget = {
  tab: chrome.tabs.Tab;
  frameId: number;
  target: { field: AutofillField; url: string };
  cipher: CipherView;
  choice: FillChoice;
  userId: UserId;
};

/** How long a pick waits for the master password before it's dropped. */
const PICK_WAITS_MS = 5 * 60 * 1000;

/** Picks waiting for the master password, by item. */
const waitingPicks = new Map<
  string,
  { pick: FillFieldTarget; deps: PickDependencies; at: number }
>();

/**
 * Fills one of an item's values into one field now, and remembers it as a
 * fill rule on the item: the picker's work, from the right-click menu or the
 * inline menu (DESIGN.md, "Choosing what fills where"). Answers whether it
 * filled the field now. For an item that asks for the master password, the
 * pick waits for the prompt (`finishPickAfterReprompt`): nothing fills, is
 * saved, or is shared before it succeeds.
 */
export async function fillFieldWith(
  pick: FillFieldTarget,
  deps: PickDependencies,
): Promise<boolean> {
  if (await deps.passwordRepromptRequired(pick.cipher)) {
    if (pick.cipher.id != null) {
      waitingPicks.set(pick.cipher.id, { pick, deps, at: Date.now() });
      await deps.openReprompt(pick.tab, pick.cipher);
    }
    return false;
  }
  return pickNow(pick, deps);
}

/**
 * The prompt's answer for a waiting pick. Only when it succeeded, and within
 * a few minutes, does the pick go ahead, with the item as it is now.
 */
export async function finishPickAfterReprompt(
  cipherId: string,
  success: boolean,
  now = Date.now(),
): Promise<boolean> {
  const waiting = waitingPicks.get(cipherId);
  waitingPicks.delete(cipherId);
  if (waiting == null || !success || now - waiting.at > PICK_WAITS_MS) {
    return false;
  }
  const { pick, deps } = waiting;
  const cipher = (await deps.cipherService.getAllDecrypted(pick.userId)).find(
    (c) => c.id === cipherId,
  );
  const choice = cipher
    ? choicesFor(cipher, undefined, await keykeeperFillPicker.showsTotp(cipher)).find(
        (c) =>
          c.key === pick.choice.key &&
          JSON.stringify(c.source) === JSON.stringify(pick.choice.source) &&
          !!c.siteWide === !!pick.choice.siteWide,
      )
    : undefined;
  if (!cipher || !choice) {
    return false;
  }
  return pickNow({ ...pick, cipher, choice }, deps);
}

/**
 * Whether a value of this item may go into the frame the field is in, by the
 * item's kind. A login's secret only where the item's websites match the
 * page or frame, by upstream's matching. A card's values (its custom fields
 * too) by the card frame rule (card-frames.ts): the page itself, its own
 * site's frames, and payment services' frames. That rule also lets a card
 * fill the frame a fill started in, but a pick always starts in the field's
 * own frame, and becomes a rule that fills there again, so that part doesn't
 * count here: another site's frame never gets a card's value. An identity's
 * values, which are plain, fill every frame, as upstream's identity fill
 * does; its secrets (hidden fields) only the page and its own site's frames.
 */
async function mayPickInto(
  cipher: CipherView,
  choice: FillChoice,
  frameId: number,
  frameUrl: string,
  tabUrl: string | undefined,
  secret: boolean,
): Promise<{ allowed: boolean; itemMatches: boolean }> {
  if (cipher.type === CipherType.Card) {
    const allowed =
      choice.source.from === "never" || cardMayFillFrame({ frameId, frameUrl, tabUrl });
    return { allowed, itemMatches: allowed };
  }
  if (cipher.type === CipherType.Identity) {
    const allowed = !secret || frameId === 0 || isPagesOwnSite(frameUrl, tabUrl);
    return { allowed, itemMatches: allowed };
  }
  // Upstream's matching: the item is for the page (or frame) the field is in.
  // A secret goes nowhere else, such as an ad's frame; anything else asks
  // first, as upstream's warning about a frame from another site does.
  const itemMatches = await keykeeperFillPicker.itemMatches(cipher, frameUrl);
  return { allowed: !secret || itemMatches, itemMatches };
}

async function pickNow(
  { tab, frameId, target, cipher, choice, userId }: FillFieldTarget,
  deps: PickDependencies,
): Promise<boolean> {
  // A two-step code only where it shows (two-step-codes.ts): nothing fills or
  // is saved otherwise.
  if (choice.source.from === "totp" && !(await keykeeperFillPicker.showsTotp(cipher))) {
    return false;
  }
  const secret = isSecretSource(cipher, choice.source);
  const { allowed, itemMatches } = await mayPickInto(
    cipher,
    choice,
    frameId,
    target.url,
    tab.url,
    secret,
  );
  if (!allowed) {
    return false;
  }
  // For someone who can't see the item's passwords, a secret goes only into
  // a password field, as with rules (fill-rules.ts).
  if (secret && !maySeeSecrets(cipher) && target.field.type !== "password") {
    return false;
  }
  const scheme = schemeOfUrl(target.url);
  const rule: FillRule = {
    v: 1,
    host: hostOf(target.url),
    ...(scheme ? { scheme } : {}),
    field: fingerprintField(target.field),
    fill: choice.source,
  };
  // A site-wide rule keeps only what decides the field, and fills nothing.
  const siteRule: FillRule = {
    ...rule,
    field: decidingFingerprint(rule.field),
    fill: { from: "never" },
  };

  let filled = false;
  if (choice.source.from !== "never") {
    const value =
      choice.source.from === "totp"
        ? (await firstValueFrom(deps.totpService.getCode$(cipher.login.totp))).code
        : fieldValueFor(cipher, choice.source, target.field);
    if (value) {
      const fillScript = new AutofillScript();
      fillScript.requiresInsecurePageConfirmation = requiresInsecurePageConfirmation(
        cipher,
        target.url,
      );
      fillScript.untrustedIframe = target.url !== tab.url && !itemMatches;
      fillScript.script.push(["click_on_opid", target.field.opid]);
      fillScript.script.push(["focus_by_opid", target.field.opid]);
      fillScript.script.push(["fill_by_opid", target.field.opid, value]);
      await BrowserApi.tabSendMessage(
        tab,
        {
          command: "fillForm",
          fillScript,
          url: tab.url,
          pageDetailsUrl: target.url,
          showAnimations: true,
        },
        { frameId },
      );
      filled = true;
      noteFill(tab.id, tab.url, cipher);
    }
  }

  if (choice.siteWide && rule.host) {
    // For every item on the site, in the person's settings. A list that's
    // full keeps it on this item instead, which still never fills it here.
    if (await keykeeperSiteNeverFill.add(siteRule)) {
      void keykeeperSiteFixes.share(siteRule).catch(() => {});
      return false;
    }
  }
  if (choice.source.from !== "never" && rule.host) {
    // A value chosen for a field the person had said never to fill on this
    // site: the newer choice wins, as a new choice for a field replaces an
    // item's older rule.
    await keykeeperSiteNeverFill.remove(siteRule);
  }
  upsertFillRule(cipher, rule);
  await deps.cipherService.updateWithServer(cipher, userId);
  // For people who share fixes; custom fields never leave the device.
  void keykeeperSiteFixes.share(rule).catch(() => {});
  return filled;
}
