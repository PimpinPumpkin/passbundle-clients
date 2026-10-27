import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherData } from "@bitwarden/common/vault/models/data/cipher.data";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherResponse } from "@bitwarden/common/vault/models/response/cipher.response";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { CipherFormConfig } from "../cipher-form/abstractions/cipher-form-config.service";
import { CipherFormService } from "../cipher-form/abstractions/cipher-form.service";

import {
  distinctVersions,
  historyPath,
  ItemHistoryResponse,
  restoredView,
  VersionEditor,
  versionPath,
} from "./item-versions";

/**
 * A version as the apps list it: decrypted, or, for someone who can't see the
 * item's passwords, only when and by whom (`view` null).
 */
export type ItemVersion = {
  id: string;
  revisionDate: Date;
  savedBy: VersionEditor | null;
  view: CipherView | null;
};

/** An item's history as the apps show it. */
export type LoadedItemHistory = {
  /** Newest first, without versions that look the same as the one before. */
  versions: ItemVersion[];
  /** Versions that couldn't be decrypted. */
  unreadable: number;
  /** The person can't see the item's passwords: versions are when and by whom only. */
  hidePasswords: boolean;
};

/**
 * Keykeeper: an item's earlier versions, for the web vault's item view and
 * the extension's history page alike (DESIGN.md, "Item history"): loading and
 * decrypting them, restoring one as a normal edit, and deleting one or all.
 * The server decides who gets what; this never decrypts a version for someone
 * the item says can't see its passwords, whatever the server sends.
 */
@Injectable()
export class KeykeeperItemHistoryService {
  private readonly apiService = inject(ApiService);
  private readonly cipherService = inject(CipherService);
  private readonly accountService = inject(AccountService);

  async load(current: CipherView): Promise<LoadedItemHistory> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const response: ItemHistoryResponse = await this.apiService.send(
      "GET",
      historyPath(current.id),
      null,
      true,
      true,
    );
    const hidePasswords = !!response?.hidePasswords || !maySeeSecrets(current);
    const versions: ItemVersion[] = [];
    let unreadable = 0;
    for (const version of response?.data ?? []) {
      const listed = {
        id: version.id,
        revisionDate: new Date(version.revisionDate),
        savedBy: version.savedBy,
      };
      if (hidePasswords || version.cipher == null) {
        // Without the item's passwords, the server sends when and by whom only.
        versions.push({ ...listed, view: null });
        continue;
      }
      // Decrypted as the vault decrypts any item from the server.
      const cipher = new Cipher(new CipherData(new CipherResponse(version.cipher)));
      const view = await this.cipherService
        .decrypt(cipher, userId)
        .catch((): CipherView | null => null);
      if (view == null || view.decryptionFailure) {
        unreadable++;
        continue;
      }
      versions.push({ ...listed, view });
    }
    const listed = hidePasswords
      ? versions
      : distinctVersions(versions as (ItemVersion & { view: CipherView })[], current);
    return { versions: listed, unreadable, hidePasswords };
  }

  /**
   * Saves a version as the item's newest, as its editor would: a normal edit
   * of the item as it is now, which the server refuses if the item changed
   * since (the save sends the revision date it knows of).
   */
  async restore(
    formService: CipherFormService,
    version: CipherView,
    current: CipherView,
    config: CipherFormConfig,
  ): Promise<CipherView> {
    return await formService.saveCipher(restoredView(version, current), config);
  }

  async deleteVersion(cipherId: string, versionId: string): Promise<void> {
    await this.apiService.send("DELETE", versionPath(cipherId, versionId), null, true, false);
  }

  async clear(cipherId: string): Promise<void> {
    await this.apiService.send("DELETE", historyPath(cipherId), null, true, false);
  }
}
