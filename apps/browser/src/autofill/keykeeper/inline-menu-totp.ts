// Keykeeper: the one-time code the fill menu inside a website shows for an
// item. Someone whose shared folders hide the item's passwords sees a mask
// instead (DESIGN.md, "Folders and permissions"): the menu still lists the
// item for a code field, and picking it still fills the real code, as
// filling is meant to.
import { maySeeSecrets, type SecretsLike } from "@bitwarden/common/vault/keykeeper/hidden-secrets";

/** Six dots, as the menu masks a code for an item that asks for the master password. */
export const MASKED_TOTP = "●●●●●●";

export function inlineMenuTotp(item: SecretsLike, code: string | undefined): string | undefined {
  if (!code) {
    return undefined;
  }
  return maySeeSecrets(item) ? code : MASKED_TOTP;
}
