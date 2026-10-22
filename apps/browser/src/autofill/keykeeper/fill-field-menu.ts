// Keykeeper fill picker: right-click any field, then "Fill this field with",
// an item, and one of its values (or "Never fill this field"). It fills the
// field now and saves the choice as a fill rule on the item (fill-rules.ts),
// so every later autofill on that site does the same.

import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { ROOT_ID } from "@bitwarden/common/autofill/constants";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
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
  keykeeperSiteFixes,
  staticValueFor,
  upsertFillRule,
  visibleCustomFields,
} from "./fill-rules";

// No underscores: menu ids are split on "_".
export const FILL_FIELD_ID = "kkfill";

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
  if (cipher.login?.password && cipher.viewPassword) {
    choices.push({ key: "p", title: STRINGS.password, source: { from: "password" } });
  }
  if (cipher.login?.totp) {
    choices.push({ key: "t", title: STRINGS.verificationCode, source: { from: "totp" } });
  }
  visibleCustomFields(cipher).forEach((field, index) => {
    // Hidden fields stay hidden from someone who can't see the item's passwords.
    if (field.type === FieldType.Hidden && !cipher.viewPassword) {
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
  /** Whether the item asks for the master password before its secrets are used. */
  passwordRepromptRequired: (cipher: CipherView) => Promise<boolean>;
  /** Asks for the master password, then fills the item into the page, rules first. */
  fillAfterReprompt: (tab: chrome.tabs.Tab, cipher: CipherView) => Promise<void>;
};

/** Whether a frame belongs to the same site as the tab it's in. */
export function sameSite(frameUrl: string, tabUrl: string | undefined): boolean {
  const frame = Utils.getDomain(frameUrl);
  return frame != null && frame !== "" && frame === Utils.getDomain(tabUrl ?? "");
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

/**
 * Fills one of an item's values into one field now, and remembers it as a
 * fill rule on the item: the picker's work, from the right-click menu or the
 * inline menu (DESIGN.md, "Choosing what fills where"). Answers whether it
 * filled the field now.
 */
export async function fillFieldWith(
  { tab, frameId, target, cipher, choice, userId }: FillFieldTarget,
  deps: Pick<
    FillFieldMenuDependencies,
    "cipherService" | "totpService" | "passwordRepromptRequired" | "fillAfterReprompt"
  >,
): Promise<boolean> {
  const secret = isSecretSource(cipher, choice.source);
  // A secret never goes into a frame from another site, such as an ad.
  if (secret && !sameSite(target.url, tab.url)) {
    return false;
  }
  // For someone who can't see the item's passwords, a secret goes only into
  // a password field, as with rules (fill-rules.ts).
  if (secret && !cipher.viewPassword && target.field.type !== "password") {
    return false;
  }
  const rule: FillRule = {
    v: 1,
    host: hostOf(target.url),
    field: fingerprintField(target.field),
    fill: choice.source,
  };

  // Like upstream's menu: secrets of an item that asks for the master password
  // wait for it. The rule is saved now, and the fill after the prompt uses it.
  if (secret && (await deps.passwordRepromptRequired(cipher))) {
    upsertFillRule(cipher, rule);
    await deps.cipherService.updateWithServer(cipher, userId);
    void keykeeperSiteFixes.share(rule).catch(() => {});
    await deps.fillAfterReprompt(tab, cipher);
    return false;
  }

  let filled = false;
  if (choice.source.from !== "never") {
    const value =
      choice.source.from === "totp"
        ? (await firstValueFrom(deps.totpService.getCode$(cipher.login.totp))).code
        : staticValueFor(cipher, choice.source);
    if (value) {
      const fillScript = new AutofillScript();
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
    }
  }

  upsertFillRule(cipher, rule);
  await deps.cipherService.updateWithServer(cipher, userId);
  // For people who share fixes; custom fields never leave the device.
  void keykeeperSiteFixes.share(rule).catch(() => {});
  return filled;
}
