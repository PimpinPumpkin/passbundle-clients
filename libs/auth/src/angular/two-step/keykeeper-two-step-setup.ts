import { Router } from "@angular/router";

import { AuthResult } from "@bitwarden/common/auth/models/domain/auth-result";
import { ClientType } from "@bitwarden/common/enums";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { DialogService } from "@bitwarden/components";

/**
 * Keykeeper: where the web vault keeps a two-step setup session for this tab
 * while the person sets up two-step login (its /two-step-setup page). Only the
 * token and who requires it; never a password or its hash.
 */
export const KEYKEEPER_TWO_STEP_SETUP = "keykeeper.twoStepSetup";

export type KeykeeperTwoStepSetupSession = { token: string; requiredBy: string[] };

/** What the sign-in hands the setup page, in memory only. */
type Handoff = { token: string; email: string | null; masterPasswordHash: string | null };
let handoff: Handoff | null = null;

/**
 * The password sign-in's email and server hash for this setup session, once.
 * Kept in memory only, so after a reload (or after single sign-on, which
 * proves no password) the setup page asks for the master password.
 */
export function keykeeperTakeTwoStepHandoff(token: string): Handoff | null {
  const found = handoff?.token === token ? handoff : null;
  handoff = null;
  return found;
}

/** Names in a sentence: "A", "A and B", "A, B, and C". */
export function keykeeperNamesPhrase(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Keykeeper: the sign-in checked out, but the person's role requires two-step
 * login and they haven't set it up, so the server gave a setup session, not a
 * login. The web vault takes them to "Set up two-step login to continue"; the
 * other apps say to set it up in the web vault, and offer to open it. True
 * when it handled the result. See DESIGN.md, "Two-step login for admins".
 */
export async function keykeeperStartTwoStepSetup(
  authResult: AuthResult,
  deps: {
    router: Router;
    i18nService: I18nService;
    dialogService: DialogService;
    platformUtilsService: PlatformUtilsService;
    clientType: ClientType;
    webVaultUrl: () => Promise<string>;
  },
): Promise<boolean> {
  const setup = authResult.keykeeperTwoStepSetup;
  if (!setup?.token) {
    return false;
  }
  if (deps.clientType !== ClientType.Web) {
    const url = await deps.webVaultUrl();
    const names = keykeeperNamesPhrase(setup.requiredBy);
    const open = await deps.dialogService.openSimpleDialog({
      title: { key: "keykeeperTwoStepSetupTitle" },
      content: names
        ? deps.i18nService.t("keykeeperTwoStepSetupInWebVault", names, url)
        : deps.i18nService.t("keykeeperTwoStepSetupInWebVaultUnnamed", url),
      acceptButtonText: { key: "keykeeperOpenWebVault" },
      cancelButtonText: { key: "close" },
      type: "warning",
    });
    if (open) {
      deps.platformUtilsService.launchUri(url);
    }
    return true;
  }
  const session: KeykeeperTwoStepSetupSession = {
    token: setup.token,
    requiredBy: setup.requiredBy,
  };
  sessionStorage.setItem(KEYKEEPER_TWO_STEP_SETUP, JSON.stringify(session));
  handoff = {
    token: setup.token,
    email: setup.email,
    masterPasswordHash: setup.masterPasswordHash,
  };
  await deps.router.navigate(["/two-step-setup"]);
  return true;
}
