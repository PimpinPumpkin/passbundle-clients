// Keykeeper: keeps script tokens' copies current (docs/script-access.md in
// the meta repo). After an item changes, any app that holds the organization
// key and can edit the item remakes its copies with the token's key, unsealed
// with the organization key, and the spec of what each copies. It runs with
// the MSP background work: on unlock, after item changes, and every few minutes.

import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperMspRequests } from "./msp-requests";
import { copyOf, KeykeeperScriptCopies, revisionText } from "./script-access";

const sameMoment = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

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
      const orgKey = orgKeys[grant.organizationId as OrganizationId];
      const item = items.find((i) => i.id === grant.itemId);
      // Without the key or the item there's nothing to do here; and an item
      // this app hasn't synced yet waits for the next run.
      if (
        orgKey == null ||
        item == null ||
        !sameMoment(revisionText(item.revisionDate), grant.revision)
      ) {
        continue;
      }
      try {
        const tokenKey = await this.copies.unsealTokenKey(grant.sealedKey, orgKey);
        const spec = await this.copies.unsealSpec(grant.sealedSpec, orgKey);
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
