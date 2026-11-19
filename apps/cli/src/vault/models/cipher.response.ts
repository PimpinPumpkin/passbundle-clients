// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CipherWithIdExport } from "@bitwarden/common/models/export/cipher-with-ids.export";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { itemWithoutSecrets } from "../../keykeeper/hidden-items";
import { repromptPassed } from "../../keykeeper/reprompt";
import { BaseResponse } from "../../models/response/base.response";
import { LoginResponse } from "../../models/response/login.response";

import { AttachmentResponse } from "./attachment.response";
import { PasswordHistoryResponse } from "./password-history.response";

export class CipherResponse extends CipherWithIdExport implements BaseResponse {
  object: string;
  attachments: AttachmentResponse[];
  revisionDate: Date;
  creationDate: Date;
  deletedDate: Date;
  passwordHistory: PasswordHistoryResponse[];

  constructor(item: CipherView) {
    super();
    this.object = "item";
    // Keykeeper: someone who can't see the item's secrets gets its plain
    // values only (keykeeper/hidden-items.ts); only an explicit yes shows them.
    // So does an item that asks for the master password again, until this
    // run has asked for it or was approved for it, and without its notes
    // either (keykeeper/reprompt.ts).
    const reprompted = !repromptPassed(item);
    const shown = maySeeSecrets(item) && !reprompted;
    const o = shown ? item : itemWithoutSecrets(item);
    if (reprompted) {
      o.notes = null;
    }
    this.build(o);
    if (reprompted) {
      this.notes = null;
    }
    // Redact the decrypted item key to prevent logging it to the CLI output.
    this.key = undefined;
    if (o.attachments != null) {
      this.attachments = o.attachments.map((a) => new AttachmentResponse(a));
    }
    this.revisionDate = o.revisionDate;
    if (o.creationDate != null) {
      this.creationDate = o.creationDate;
    }
    this.deletedDate = o.deletedDate;
    // `build()` unconditionally copies password history and hidden field values from the view,
    // so they must be explicitly redacted here when the user doesn't have permission to view
    // passwords (matching how the web/browser/desktop clients gate hidden field reveal on the
    // same permission).
    if (!shown) {
      this.passwordHistory = undefined;
      this.fields?.forEach((field) => {
        if (field.type === FieldType.Hidden) {
          field.value = null;
        }
      });
    } else if (o.passwordHistory != null) {
      this.passwordHistory = o.passwordHistory.map((h) => new PasswordHistoryResponse(h));
    }
    if (o.type === CipherType.Login && o.login != null) {
      this.login = new LoginResponse(o.login, shown);
    }
  }
}
