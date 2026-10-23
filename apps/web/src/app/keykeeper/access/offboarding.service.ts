import { Injectable } from "@angular/core";

import { canAccessVaultTab } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { DialogService } from "@bitwarden/components";

import { canReviewAccess, passwordsSeenBy, reachSentence } from "./access-review";
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
    if (!canReviewAccess(organization)) {
      return null;
    }
    try {
      const loaded = await this.accessReview.load(organization);
      const access = loaded.review.members.find((m) => m.member.id === memberId);
      if (access == null) {
        return null;
      }
      const t = (key: string, ...args: string[]) => this.i18nService.t(key, ...args);
      return {
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
      };
    } catch (e) {
      this.logService.error(e);
      return null;
    }
  }

  /** After the member is removed or revoked: the passwords to change, if there are any. */
  showPasswords(offboarding: KeykeeperOffboarding | null) {
    if (offboarding == null || offboarding.dialog.passwords.length === 0) {
      return;
    }
    KeykeeperSeenPasswordsDialogComponent.open(this.dialogService, offboarding.dialog);
  }
}
