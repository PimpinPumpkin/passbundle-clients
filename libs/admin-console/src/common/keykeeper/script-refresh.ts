// Keykeeper: keeps script tokens' copies current (docs/script-access.md in
// the meta repo). After an item changes, any app that holds the organization
// key and can edit the item remakes its copies with the token's key, unsealed
// with the organization key, and the spec of what each copies. It runs with
// the MSP background work: on unlock, after item changes, and every few minutes.
//
// The server lists what's behind, and a hacked one could list anything: a
// token's key paired with the person's own items, another organization's, or
// an item the token was never granted. So a copy is remade only for an item
// in the token's own organization, not in the trash, that this person can
// edit and see the passwords of, with a token key sealed for that token and a
// spec sealed for that token and that item.

import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperMspRequests } from "./msp-requests";
import { StaleScriptGrant } from "./msp-types";
import { copyOf, KeykeeperScriptCopies, revisionText } from "./script-access";

const sameMoment = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

/**
 * Whether this app may remake a grant's copy from this item: the item is in
 * the grant's organization and not in the trash, and the person can edit it
 * and see its passwords. Anything else stays as it is, whatever the server
 * listed.
 */
export function mayRefresh(grant: StaleScriptGrant, item: CipherView): boolean {
  return (
    item.organizationId != null &&
    item.organizationId === grant.organizationId &&
    !item.isDeleted &&
    item.edit === true &&
    maySeeSecrets(item)
  );
}

export class KeykeeperScriptRefresher {
  constructor(
    private readonly requests: KeykeeperMspRequests,
    private readonly copies: KeykeeperScriptCopies,
    private readonly keyService: KeyService,
    private readonly cipherService: CipherService,
    private readonly accountService: AccountService,
  ) {}

  /** Remakes copies that are behind their items. Resolves to what failed, in sentences. */
  async refresh(): Promise<string[]> {
    const stale = await this.requests.staleScriptGrants();
    if (stale.length === 0) {
      return [];
    }
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const orgKeys = (await firstValueFrom(this.keyService.orgKeys$(userId))) ?? {};
    const items = await this.cipherService.getAllDecrypted(userId);
    const failures: string[] = [];
    for (const grant of stale) {
      const item = items.find((i) => i.id === grant.itemId);
      // Without the item there's nothing to do here; an item this app hasn't
      // synced yet waits for the next run; and an item the grant can't be for
      // is left alone.
      if (
        item == null ||
        !mayRefresh(grant, item) ||
        !sameMoment(revisionText(item.revisionDate), grant.revision)
      ) {
        continue;
      }
      const orgKey = orgKeys[item.organizationId as OrganizationId];
      if (orgKey == null) {
        continue;
      }
      try {
        const tokenKey = await this.copies.unsealTokenKey(grant.sealedKey, orgKey, grant.tokenId);
        const spec = await this.copies.unsealSpec(grant.sealedSpec, orgKey, grant.tokenId, item.id);
        const copy = await this.copies.encryptCopy(copyOf(grant.tokenId, item, spec), tokenKey);
        await this.requests.setScriptGrant(grant.organizationId, grant.tokenId, grant.itemId, {
          copy,
          revision: revisionText(item.revisionDate),
          sealedSpec: grant.sealedSpec,
        });
      } catch (e) {
        failures.push(
          `A script token's copy of ${item.name} wasn't updated: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return failures;
  }
}
