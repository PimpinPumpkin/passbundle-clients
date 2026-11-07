// Keykeeper: imports the SDK reads (KeePass's .kdbx today) get the same check
// for our own field names as every other import (reserved-fields.ts). The
// SDK reads the file, encrypts the items, and sends them to the server itself,
// and gives back only counts, so the check can't run before the items are
// saved, as it does for the importers in this library. It runs right after,
// inside the same call (ImportService.importWithSdk, which every SDK importer
// goes through):
//
// 1. Before the SDK runs, the destination's items are read from the server
//    (Personal: a full sync; an organization from its admin console: the
//    organization's items, as its admin console reads them). If that fails,
//    nothing is imported.
// 2. After, they're read again. Items there now that weren't before are the
//    import's. Fewer of them than the SDK says it imported means some can't
//    be seen to be checked, and the import says so. More of them after an
//    empty first read means that read can't be trusted: nothing is changed,
//    and the import says so.
// 3. Each of the import's items with a field named like ours gets the same
//    treatment as from any other password manager: the field keeps its value
//    under a visible name ("Imported keykeeper.fill"), and the item is saved.
// 4. An item that can't be saved that way goes to the trash, so nothing with
//    a planted rule is left to fill, and the import says so. If even that
//    fails, the import names the items.
//
// Between the SDK saving the items and step 3 there are a few seconds in
// which another device can sync them as they came. See DESIGN.md, "Our own
// fields never come in from a file".

import { firstValueFrom } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { isReservedFieldName } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { ImportResult } from "../../models/import-result";
import { SdkImportSummary } from "../../sdk/sdk-import-summary";

import { guardReservedFields } from "./reserved-fields";

/** Where an SDK import puts its items, and as whom. */
export type SdkImportDestination = {
  userId: UserId;
  /** Null for Personal. */
  organizationId: OrganizationId | null;
  /** From the organization's admin console (or the CLI, which checked the permission). */
  asAdmin: boolean;
};

/** What was there before the import: the ids of the destination's items. */
export type SdkImportBaseline = { ids: Set<string> };

/** An error the person sees, in our words; in English where a client has none of ours (the CLI). */
function say(i18n: I18nService, key: string, english: string, ...args: (string | number)[]) {
  return i18n.t(key, ...args) || english.replace(/__\$(\d)__/g, (_, n) => String(args[n - 1]));
}

const hasOurFields = (cipher: CipherView) =>
  (cipher.fields ?? []).some((field) => isReservedFieldName(field.name));

/** A destination's items: their ids, and the items themselves for some of them. */
type Listing = { ids: string[]; items: (ids: Set<string>) => Promise<CipherView[]> };

export class SdkImportCheck {
  constructor(
    private cipherService: CipherService,
    private syncService: SyncService,
    private organizationService: OrganizationService,
    private i18nService: I18nService,
  ) {}

  /** Step 1: what's in the destination before the SDK runs. Throws when that can't be read. */
  async before(destination: SdkImportDestination): Promise<SdkImportBaseline> {
    try {
      return { ids: new Set((await this.list(destination)).ids) };
    } catch {
      throw new Error(
        say(
          this.i18nService,
          "keykeeperImportCheckNotStarted",
          "Your items couldn't be read to check this import, so nothing was imported. Try again.",
        ),
      );
    }
  }

  /** Steps 2 to 4, once the SDK has saved the import's items. Throws when they weren't all checked. */
  async after(
    destination: SdkImportDestination,
    baseline: SdkImportBaseline,
    summary: SdkImportSummary,
  ): Promise<void> {
    const expected = (summary?.ciphers ?? []).reduce((total, entry) => total + entry.count, 0);
    let imported: CipherView[];
    try {
      const listing = await this.list(destination);
      const added = listing.ids.filter((id) => !baseline.ids.has(id));
      // Nothing there before, and more there now than the import made: the
      // first read may have come back empty without saying so, and then every
      // item there would look like the import's. Nothing is changed.
      if (baseline.ids.size === 0 && added.length > expected) {
        throw new Error("Can't tell the import's items from the others.");
      }
      imported = await listing.items(new Set(added));
    } catch {
      throw new Error(
        say(
          this.i18nService,
          "keykeeperImportCheckNotRead",
          'The import finished, but its items couldn\'t be read back to be checked. Reload, then look in the items you imported for fields whose names start with "keykeeper." and delete those fields.',
        ),
      );
    }

    // Step 3: the same check as for any other password manager's file.
    const planted = imported.filter(hasOurFields);
    guardReservedFields({ ciphers: planted } as ImportResult, "other");
    const unsaved: CipherView[] = [];
    for (const item of planted) {
      try {
        await this.cipherService.updateWithServer(
          item,
          destination.userId,
          undefined,
          destination.asAdmin,
        );
      } catch {
        unsaved.push(item);
      }
    }

    // Step 4.
    if (unsaved.length > 0) {
      // The first few names, so a long list doesn't swamp the message.
      const names = unsaved
        .slice(0, 10)
        .map((item) => item.name)
        .concat(unsaved.length > 10 ? [`+${unsaved.length - 10}`] : [])
        .join(", ");
      try {
        await this.cipherService.softDeleteManyWithServer(
          unsaved.map((item) => item.id),
          destination.userId,
          destination.asAdmin,
          destination.organizationId ?? undefined,
        );
      } catch {
        throw new Error(
          say(
            this.i18nService,
            "keykeeperImportCheckNotSaved",
            "The import finished, but these items have fields whose names start with \"keykeeper.\" that couldn't be changed, and the items couldn't be moved to the trash: __$1__. Delete them.",
            names,
          ),
        );
      }
      throw new Error(
        say(
          this.i18nService,
          "keykeeperImportCheckTrashed",
          "The import finished, but these items have fields whose names start with \"keykeeper.\" that couldn't be changed, so they're in the trash: __$1__.",
          names,
        ),
      );
    }
    if (imported.length < expected) {
      throw new Error(
        say(
          this.i18nService,
          "keykeeperImportCheckMissing",
          'The import finished, but only __$1__ of its __$2__ items could be checked. Look in the others for fields whose names start with "keykeeper." and delete those fields.',
          imported.length,
          expected,
        ),
      );
    }
  }

  /** The destination's items as the server has them now. */
  private async list(destination: SdkImportDestination): Promise<Listing> {
    const { userId, organizationId, asAdmin } = destination;
    if (organizationId != null && asAdmin) {
      // As the organization's admin console reads them, so this asks the
      // server for nothing that page doesn't. An import from there can leave
      // items in no shared folder, which a sync doesn't show.
      const organization = (
        await firstValueFrom(this.organizationService.organizations$(userId))
      ).find((org) => org.id === organizationId);
      if (organization == null) {
        throw new Error("Not a member of the organization.");
      }
      const all = organization.canEditAllCiphers
        ? await this.cipherService.getAllFromApiForOrganization(organizationId)
        : await this.cipherService.getManyFromApiForOrganization(organizationId);
      return {
        ids: all.map((item) => item.id),
        items: async (ids) => all.filter((item) => ids.has(item.id)),
      };
    }
    // A sync that didn't finish leaves the stored items as they were, which
    // would make items added elsewhere since look like the import's.
    if (!(await this.syncService.fullSync(true, { allowThrowOnError: true }))) {
      throw new Error("The sync didn't finish.");
    }
    const stored = Object.values(
      (await firstValueFrom(this.cipherService.ciphers$(userId))) ?? {},
    ).filter((data) => (data.organizationId ?? null) === organizationId);
    return {
      ids: stored.map((data) => data.id),
      items: async (ids) => {
        const items: CipherView[] = [];
        for (const data of stored.filter((data) => ids.has(data.id))) {
          items.push(await this.cipherService.decrypt(new Cipher(data), userId));
        }
        return items;
      },
    };
  }
}
