// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { OptionValues } from "commander";
import * as inquirer from "inquirer";
import { firstValueFrom, switchMap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { exportsWholeOrganization } from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { EventCollectionService, EventType } from "@bitwarden/common/dirt/event-logs";
import { getById } from "@bitwarden/common/platform/misc";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import {
  ExportFormat,
  EXPORT_FORMATS,
  VaultExportServiceAbstraction,
  ExportedVault,
  ExportedVaultAsBlob,
} from "@bitwarden/vault-export-core";

import { reprompt } from "../keykeeper/reprompt";
import { Response } from "../models/response";
import { CliUtils } from "../utils";

export class ExportCommand {
  constructor(
    private exportService: VaultExportServiceAbstraction,
    private policyService: PolicyService,
    private eventCollectionService: EventCollectionService,
    private accountService: AccountService,
    // Keykeeper: who the person is in the organization they export, which
    // decides where its export comes from (exportsWholeOrganization).
    private organizationService: OrganizationService,
    // Keykeeper: whether what it writes holds an item that asks for the
    // master password again (keykeeper/reprompt.ts).
    private cipherService?: CipherService,
  ) {}

  async run(options: OptionValues): Promise<Response> {
    const policyApplies$ = this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) =>
        this.policyService.policyAppliesToUser$(PolicyType.DisablePersonalVaultExport, userId),
      ),
    );

    if (options.organizationid == null && (await firstValueFrom(policyApplies$))) {
      return Response.badRequest(
        "One or more organization policies prevents you from exporting your personal vault.",
      );
    }

    let password = options.password;

    // has password and format is 'json' => should have the same behaviour as 'encrypted_json'
    // format is 'undefined' => Defaults to 'csv'
    // Any other case => returns the options.format
    const format =
      password && options.format == "json" ? "encrypted_json" : (options.format ?? "csv");

    if (!this.isSupportedExportFormat(format)) {
      return Response.badRequest(
        `'${format}' is not a supported export format. Supported formats: ${EXPORT_FORMATS.join(
          ", ",
        )}.`,
      );
    }

    if (options.organizationid != null && !Utils.isGuid(options.organizationid)) {
      return Response.error("`" + options.organizationid + "` is not a GUID.");
    }

    let exportContent: ExportedVault = null;
    try {
      if (format === "encrypted_json") {
        password = await this.promptPassword(password);
      }

      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));

      // Keykeeper: an export that would write an item that asks for the
      // master password again asks first, or needs --reprompt-ok in a
      // script (keykeeper/reprompt.ts). A personal export holds the
      // person's own items; an organization's, that organization's.
      if (this.cipherService != null) {
        const written = (await this.cipherService.getAllDecrypted(userId)).filter(
          (c) =>
            !c.isDeleted &&
            (options.organizationid == null
              ? c.organizationId == null
              : c.organizationId === options.organizationid),
        );
        const refused = await reprompt(written, { what: "This export holds items that ask" });
        if (refused != null) {
          return Response.error(refused);
        }
      }

      exportContent =
        options.organizationid == null
          ? await this.exportService.getExport(userId, format, password)
          : await this.exportService.getOrganizationExport(
              userId,
              options.organizationid,
              format,
              password,
              await this.onlyFoldersTheyCanExport(userId, options.organizationid),
            );

      const eventType = options.organizationid
        ? EventType.Organization_ClientExportedVault
        : EventType.User_ClientExportedVault;
      // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.eventCollectionService.collect(eventType, null, true, options.organizationid);
    } catch (e) {
      return Response.error(e);
    }
    return await this.saveFile(exportContent, options);
  }

  private async saveFile(exportContent: ExportedVault, options: OptionValues): Promise<Response> {
    try {
      if (exportContent.type === "application/zip") {
        exportContent = exportContent as ExportedVaultAsBlob;
        const arrayBuffer = await exportContent.data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return await CliUtils.saveResultToFile(buffer, options.output, exportContent.fileName);
      }

      return await CliUtils.saveResultToFile(
        exportContent.data,
        options.output,
        exportContent.fileName,
      );
    } catch (e) {
      return Response.error(e.toString());
    }
  }

  private async promptPassword(password: string | boolean) {
    // boolean => flag set with no value, we need to prompt for password
    // string => flag set with value, use this value for password
    // undefined/null/false => account protect, not password, no password needed
    if (typeof password === "string") {
      return password;
    } else if (password) {
      const answer: inquirer.Answers = await inquirer.createPromptModule({
        output: process.stderr,
      })({
        type: "password",
        name: "password",
        message: "Export file password:",
      });
      return answer.password as string;
    }
    return null;
  }

  /**
   * Keykeeper: the whole organization, from the server's export, only for
   * owners, admins, and a custom role with import and export and access to
   * all items, whom it answers. Everyone else exports the shared folders
   * where they can export, from their own synced items, as the web vault's
   * Export does; the server's export would refuse them, and its 401 for a
   * regular member signed the tool out (DESIGN.md, "Folders and
   * permissions").
   */
  private async onlyFoldersTheyCanExport(userId: UserId, organizationId: string) {
    const organization = await firstValueFrom(
      this.organizationService.organizations$(userId).pipe(getById(organizationId)),
    );
    return !exportsWholeOrganization(organization);
  }

  private isSupportedExportFormat(format: string): format is ExportFormat {
    return EXPORT_FORMATS.includes(format as ExportFormat);
  }
}
