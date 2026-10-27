// Keykeeper: "Stay unlocked when I reload", the web vault's own setting for
// keeping a tab unlocked across a reload, per account, kept in this browser
// across sessions. Here, in the session timeout code, because a policy that
// takes "On browser refresh" away turns it off (see VaultTimeoutSettingsService),
// so a person who chose to lock at every reload still does. See DESIGN.md,
// "Staying unlocked across a reload", in the meta repo.
import { KEYKEEPER_RELOAD_SETTING_DISK, UserKeyDefinition } from "@bitwarden/state";

export type KeykeeperReloadSetting = {
  /** Whether a reload keeps the vault unlocked; on unless turned off. */
  on: boolean;
  /** Why it's off, when the web vault turned it off rather than the person. */
  because?: "onBrowserRefreshReplaced";
};

export const KEYKEEPER_STAY_UNLOCKED_ON_RELOAD = new UserKeyDefinition<KeykeeperReloadSetting>(
  KEYKEEPER_RELOAD_SETTING_DISK,
  "stayUnlockedOnReload",
  {
    deserializer: (value) => value,
    clearOn: [],
  },
);
