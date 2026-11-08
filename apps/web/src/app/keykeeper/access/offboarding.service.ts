import { Injectable } from "@angular/core";

import { canAccessVaultTab } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { DialogService } from "@bitwarden/components";

import {
  canReviewAccess,
  combineSeen,
  listNames,
  passwordsSeenBy,
  reachSentence,
} from "./access-review";
import { KeykeeperAccessReviewService } from "./access-review.service";
import {
  KeykeeperSeenPasswordsDialogComponent,
  SeenPasswordsDialogData,
} from "./seen-passwords-dialog.component";

/** What someone being removed or revoked could see, worked out before anyone confirms. */
export type KeykeeperOffboarding = {
  /** One sentence for the confirmation, such as "Alex can open 3 shared folders with 42 items." */
  summary: string;
  /** For the list shown after they're removed or revoked. */
  dialog: SeenPasswordsDialogData;
};

/**
 * Keykeeper: removing or revoking a member says what they can open, and once
 * it's done, lists the passwords they could see so they can be changed.
 * Nothing is stored: the list is computed in the browser from what the
 * admin console loads, and shown once. See DESIGN.md, "Access and
 * offboarding".
 */
@Injectable({ providedIn: "root" })
export class KeykeeperOffboardingService {
  constructor(
    private readonly accessReview: KeykeeperAccessReviewService,
    private readonly dialogService: DialogService,
    private readonly i18nService: I18nService,
    private readonly logService: LogService,
  ) {}

  /**
   * What a member could see, for the confirmation. Never stands in the way of
   * removing someone: null when it can't be worked out.
   */
  async prepare(
    organization: Organization,
    memberId: string,
    name: string,
  ): Promise<KeykeeperOffboarding | null> {
    const prepared = await this.prepareMany(organization, [{ id: memberId, name }]);
    return prepared.get(memberId) ?? null;
  }

  /**
   * The same for several members at once, as bulk remove and revoke confirm
   * them: what each can open, by member id. The access review loads once,
   * from what the admin console already shows, so it lists nothing the
   * person removing them couldn't see. Empty when it can't be worked out.
   */
  async prepareMany(
    organization: Organization,
    members: { id: string; name: string }[],
  ): Promise<Map<string, KeykeeperOffboarding>> {
    const prepared = new Map<string, KeykeeperOffboarding>();
    if (!canReviewAccess(organization) || members.length === 0) {
      return prepared;
    }
    try {
      const loaded = await this.accessReview.load(organization);
      const t = (key: string, ...args: string[]) => this.i18nService.t(key, ...args);
      for (const { id, name } of members) {
        const access = loaded.review.members.find((m) => m.member.id === id);
        if (access == null) {
          continue;
        }
        prepared.set(id, {
          summary: reachSentence(name, access, loaded.review, t),
          dialog: {
            name,
            organizationId: organization.id,
            openInAdminConsole: canAccessVaultTab(organization),
            everyItem: access.everyItem != null,
            // Someone never confirmed never had the key, so they saw nothing.
            passwords:
              access.member.status === "pending"
                ? []
                : passwordsSeenBy(
                    access,
                    loaded.itemInputs,
                    loaded.review.folders.map((f) => f.folder),
                  ),
            items: loaded.items,
          },
        });
      }
    } catch (e) {
      this.logService.error(e);
      prepared.clear();
    }
    return prepared;
  }

  /** After the member is removed or revoked: the passwords to change, if there are any. */
  showPasswords(offboarding: KeykeeperOffboarding | null) {
    if (offboarding == null || offboarding.dialog.passwords.length === 0) {
      return;
    }
    KeykeeperSeenPasswordsDialogComponent.open(this.dialogService, offboarding.dialog);
  }

  /**
   * After a bulk remove or revoke: one list of the passwords any of the
   * people it removed or revoked could see (`done`, by member id), saying who
   * could see each. Those it didn't remove or revoke aren't in it.
   */
  showPasswordsOfMany(prepared: Map<string, KeykeeperOffboarding>, done: string[]) {
    // Only people who could see a password: someone never confirmed saw nothing.
    const gone = done
      .map((id) => prepared.get(id))
      .filter((o): o is KeykeeperOffboarding => o != null && o.dialog.passwords.length > 0);
    if (gone.length <= 1) {
      this.showPasswords(gone[0] ?? null);
      return;
    }
    const [first] = gone;
    this.showPasswords({
      summary: "",
      dialog: {
        ...first.dialog,
        name: this.names(gone.map((o) => o.dialog.name)),
        everyItem: gone.some((o) => o.dialog.everyItem),
        passwords: combineSeen(
          gone.map((o) => ({ name: o.dialog.name, seen: o.dialog.passwords })),
        ),
        people: gone.map((o) => ({ name: o.dialog.name, everyItem: o.dialog.everyItem })),
      },
    });
  }

  /** "Alex, Sam, and Jo", in the web vault's language. */
  private names(names: string[]): string {
    return listNames(names, this.i18nService.translationLocale);
  }
}
