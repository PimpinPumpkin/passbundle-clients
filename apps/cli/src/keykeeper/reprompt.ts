// Keykeeper: "Master password re-prompt" in the command-line tool (DESIGN.md,
// "Command-line tool", "Master password re-prompt", in the meta repo). An item
// marked for it asks for the master password again before a command shows or
// changes its secrets (`get item`, `get password`, `get totp`, `get notes`,
// `get exposed`, `get attachment`, `edit item`, and `export` when it would
// write one); every other command gives its plain values only, with its notes
// taken out too (cipher.response.ts). A run that can't ask (a script, or
// `serve`) refuses, unless the command line says `--reprompt-ok`: the script
// was approved for such items. Like the other apps' re-prompt, it's a second
// check against someone at an unlocked session, not encryption.

import * as inquirer from "inquirer";

import { CipherRepromptType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { CLI_BRAND } from "./brand";

/** This run's answers: approved for all of them (`--reprompt-ok`), or the items it asked for. */
const run = { approved: false, confirmed: new Set<string>() };

/** `--reprompt-ok` on the command line: this run reads and changes such items without asking. */
export function approveReprompted(): void {
  run.approved = true;
}

/** For tests: a run that hasn't asked or been approved. */
export function resetReprompt(): void {
  run.approved = false;
  run.confirmed.clear();
}

/** Whether the item asks for the master password again. */
export function asksAgain(item: Pick<CipherView, "reprompt"> | null | undefined): boolean {
  return item?.reprompt === CipherRepromptType.Password;
}

/**
 * Whether this run may show the item's secrets: it doesn't ask, the run was
 * approved for such items, or the master password was given for it here.
 */
export function repromptPassed(
  item: Pick<CipherView, "reprompt" | "id"> | null | undefined,
): boolean {
  return !asksAgain(item) || run.approved || (item?.id != null && run.confirmed.has(item.id));
}

/** How a check of the master password is made: upstream's user verification. */
export type MasterPasswordCheck = {
  hasMasterPassword: () => Promise<boolean>;
  /** True for the right master password; false (or throws) otherwise. */
  verify: (password: string) => Promise<boolean>;
};

export type RepromptDeps = MasterPasswordCheck & {
  /** Whether `serve` is answering. */
  serving: () => boolean;
  /** Whether someone can be asked: interaction allowed, and stdin and stderr are a terminal. */
  canAsk: () => boolean;
  /** Asks for the master password, without echoing it. */
  ask: (question: string) => Promise<string>;
};

let check: MasterPasswordCheck | null = null;

/** The service container's check, set once at startup (bw.ts). */
export function useMasterPasswordCheck(masterPasswordCheck: MasterPasswordCheck): void {
  check = masterPasswordCheck;
}

const ASKS = '"Master password re-prompt"';

export function scriptRefusal(what = "This item asks"): string {
  return (
    `${what} for your master password again (${ASKS}), and this run can't ask for it. ` +
    "Run the command in a terminal, or add --reprompt-ok if this script was approved to read " +
    "such items."
  );
}

export function serveRefusal(what = "This item asks"): string {
  return (
    `${what} for your master password again (${ASKS}), which \`${CLI_BRAND.command} serve\` ` +
    "can't ask for. Start it with --reprompt-ok to let what reaches it read such items."
  );
}

export const WRONG_PASSWORD = "That isn't your master password, so the item stays closed.";

function defaultDeps(): RepromptDeps {
  return {
    hasMasterPassword: async () => (check == null ? true : await check.hasMasterPassword()),
    verify: async (password) => (check == null ? false : await check.verify(password)),
    serving: () => process.env.BW_SERVE === "true",
    canAsk: () =>
      process.env.BW_NOINTERACTION !== "true" &&
      process.env.BW_SERVE !== "true" &&
      !!process.stdin.isTTY &&
      !!process.stderr.isTTY,
    ask: async (question) =>
      (
        await inquirer.createPromptModule({ output: process.stderr })({
          type: "password",
          name: "password",
          message: question,
        })
      ).password,
  };
}

/**
 * Before a command shows or changes these items' secrets: null to go on, or
 * why it can't. Asks once for all of them, when it may ask.
 */
export async function reprompt(
  items: (Pick<CipherView, "reprompt" | "id"> | null | undefined)[],
  options: { what?: string } = {},
  deps: RepromptDeps = defaultDeps(),
): Promise<string | null> {
  const waiting = items.filter((item) => !repromptPassed(item));
  if (waiting.length === 0) {
    return null;
  }
  const confirm = () => waiting.forEach((item) => item?.id != null && run.confirmed.add(item.id));
  // An account that unlocks without a master password (a key connector's)
  // has nothing to ask for, as in upstream's apps.
  if (!(await deps.hasMasterPassword())) {
    confirm();
    return null;
  }
  if (deps.serving()) {
    return serveRefusal(options.what);
  }
  if (!deps.canAsk()) {
    return scriptRefusal(options.what);
  }
  const password = await deps.ask(
    `Master password (${waiting.length === 1 ? "this item asks" : "these items ask"} for it again):`,
  );
  let right = false;
  try {
    right = password != null && password !== "" && (await deps.verify(password));
  } catch {
    right = false;
  }
  if (!right) {
    return WRONG_PASSWORD;
  }
  confirm();
  return null;
}
