// Keykeeper fill picker: right-click any field, then "Fill this field with",
// an item, and one of its values (or "Never fill this field"). It fills the
// field now and saves the choice as a fill rule on the item (fill-rules.ts),
// so every later autofill on that site does the same. An item that asks for
// the master password asks first, for any choice, and nothing fills or is
// saved unless the prompt succeeds.

import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { ROOT_ID } from "@bitwarden/common/autofill/constants";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { BrowserApi } from "../../platform/browser/browser-api";
import AutofillField from "../models/autofill-field";
import AutofillScript from "../models/autofill-script";
import { AutofillTriageResponse } from "../types/autofill-triage";

import {
  FillRule,
  FillSource,
  fingerprintField,
  hostOf,
  isSecretSource,
  schemeOfUrl,
  keykeeperSiteFixes,
  staticValueFor,
  upsertFillRule,
  visibleCustomFields,
} from "./fill-rules";
import { noteFill } from "./hidden-fills";

// No underscores: menu ids are split on "_".
export const FILL_FIELD_ID = "kkfill";

export { FILL_FIELD_REPROMPT_ACTION, FILL_FIELD_REPROMPTED } from "./fill-field-reprompt";

/**
 * What the picker asks of the background, set by main.background: whether an
 * item is for a page, by its websites and the person's match settings, as
 * upstream's autofill decides it. Until then, nothing is.
 */
export const keykeeperFillPicker = {
  itemMatches: async (_cipher: CipherView, _url: string): Promise<boolean> => false,
};

// English until Keykeeper's own strings are translated.
const STRINGS = {
  fillThisFieldWith: "Fill this field with",
  username: "Username",
  password: "Password",
  verificationCode: "Verification code",
  neverFillThisField: "Never fill this field",
};

export type FillChoice = { key: string; title: string; source: FillSource };

/** What an item can fill into a field, in menu order. */
export function choicesFor(cipher: CipherView): FillChoice[] {
  const choices: FillChoice[] = [];
  if (cipher.login?.username) {
    choices.push({ key: "u", title: STRINGS.username, source: { from: "username" } });
  }
  if (cipher.login?.password && maySeeSecrets(cipher)) {
    choices.push({ key: "p", title: STRINGS.password, source: { from: "password" } });
  }
  if (cipher.login?.totp) {
    choices.push({ key: "t", title: STRINGS.verificationCode, source: { from: "totp" } });
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
  choices.push({ key: "n", title: STRINGS.neverFillThisField, source: { from: "never" } });
  return choices;
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

export async function initFillFieldMenu(): Promise<void> {
  createdFillFieldMenuIds.clear();
  await create({ id: FILL_FIELD_ID, parentId: ROOT_ID, title: STRINGS.fillThisFieldWith });
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

/** Adds an item, with its values, under "Fill this field with". */
export async function addCipherToFillFieldMenu(cipher: CipherView | undefined): Promise<void> {
  if (!cipher?.id || cipher.type !== CipherType.Login) {
    return;
  }
  const parentId = `${FILL_FIELD_ID}_${cipher.id}`;
  if (createdFillFieldMenuIds.has(parentId)) {
    return;
  }
  await create({ id: parentId, parentId: FILL_FIELD_ID, title: sanitizeTitle(cipher.name ?? "") });
  createdFillFieldMenuIds.add(parentId);
  for (const choice of choicesFor(cipher)) {
    if (choice.source.from === "never") {
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

/** The item's websites, for upstream's warning before filling an http page. */
function savedUrls(cipher: CipherView): string[] {
  return (cipher.login?.uris ?? [])
    .filter((u) => u.match != UriMatchStrategy.Never && u.uri != null)
    .map((u) => u.uri);
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
    (c) => c.id === parsed.cipherId,
  );
  const choice = cipher ? choicesFor(cipher).find((c) => c.key === parsed.key) : undefined;
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
const waitingPicks = new Map<string, { pick: FillFieldTarget; deps: PickDependencies; at: number }>();

/**
 * Fills one of an item's values into one field now, and remembers it as a
 * fill rule on the item: the picker's work, from the right-click menu or the
 * inline menu (DESIGN.md, "Choosing what fills where"). Answers whether it
 * filled the field now. For an item that asks for the master password, the
 * pick waits for the prompt (`finishPickAfterReprompt`): nothing fills, is
 * saved, or is shared before it succeeds.
 */
export async function fillFieldWith(pick: FillFieldTarget, deps: PickDependencies): Promise<boolean> {
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
    ? choicesFor(cipher).find(
        (c) =>
          c.key === pick.choice.key &&
          JSON.stringify(c.source) === JSON.stringify(pick.choice.source),
      )
    : undefined;
  if (!cipher || !choice) {
    return false;
  }
  return pickNow({ ...pick, cipher, choice }, deps);
}

async function pickNow(
  { tab, frameId, target, cipher, choice, userId }: FillFieldTarget,
  deps: PickDependencies,
): Promise<boolean> {
  const secret = isSecretSource(cipher, choice.source);
  // Upstream's matching: the item is for the page (or frame) the field is in.
  // A secret goes nowhere else, such as an ad's frame; anything else asks
  // first, as upstream's warning about a frame from another site does.
  const itemMatches = await keykeeperFillPicker.itemMatches(cipher, target.url);
  if (secret && !itemMatches) {
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

  let filled = false;
  if (choice.source.from !== "never") {
    const value =
      choice.source.from === "totp"
        ? (await firstValueFrom(deps.totpService.getCode$(cipher.login.totp))).code
        : staticValueFor(cipher, choice.source);
    if (value) {
      const fillScript = new AutofillScript();
      fillScript.savedUrls = savedUrls(cipher);
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

  upsertFillRule(cipher, rule);
  await deps.cipherService.updateWithServer(cipher, userId);
  // For people who share fixes; custom fields never leave the device.
  void keykeeperSiteFixes.share(rule).catch(() => {});
  return filled;
}
