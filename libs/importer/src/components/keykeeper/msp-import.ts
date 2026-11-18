// Keykeeper: what the import screen adds for Passportal's and IT Glue's
// exports (importers/msp): their export steps, and, into an organization, the
// question of whose rows go in when the file names more than one customer
// (msp-customer-dialog.component.ts). DESIGN.md, "Importing from other
// password managers".

import { lastValueFrom } from "rxjs";

import { DialogService } from "@bitwarden/components";

import { Importer } from "../../importers/importer";
import { MspCsvImporter } from "../../importers/msp";
import { ImportType } from "../../models/import-options";

import { KeykeeperMspCustomerDialogComponent } from "./msp-customer-dialog.component";

const STEPS: Partial<Record<ImportType, string>> = {
  passportalcsv:
    "In Passportal, open Settings, then Import / Export. Under Export, choose Passwords, check " +
    "Include headers (and Include TOTP secret to bring one-time codes), then choose Export. Each " +
    "client comes in as a folder, with Passportal's folders under it. Delete the file once it's " +
    "imported: it has every password in plain text.",
  itgluecsv:
    "In IT Glue, open Admin, then Export Data. Choose Data for an organization or Entire account, " +
    "then Start Export. IT Glue emails you when the ZIP file is ready. Unzip it and choose its " +
    "passwords.csv here. Each IT Glue organization comes in as a folder, with its password " +
    "folders under it. Personal passwords aren't in IT Glue's export. Delete the files once " +
    "they're imported: they have every password in plain text.",
};

/** How to export from Passportal or IT Glue, or null for any other format. */
export function mspImportSteps(format: ImportType | null | undefined): string | null {
  return (format != null && STEPS[format]) || null;
}

/**
 * Into an organization, when a Passportal or IT Glue file names more than one
 * customer: asks whose rows go in, and sets the importer to import only
 * those (or all of them). True to go on with the import, false when the
 * person closed the question without choosing. Any other importer, or a file
 * that isn't the format's (which the import then refuses, saying why), goes
 * on without a question.
 */
export async function chooseMspCustomer(
  dialogService: DialogService,
  importer: Importer,
  contents: string,
  organizationName: string,
): Promise<boolean> {
  if (!(importer instanceof MspCsvImporter)) {
    return true;
  }
  const customers = importer.customers(contents);
  if (customers == null || customers.length < 2) {
    return true;
  }
  const choice = await lastValueFrom(
    KeykeeperMspCustomerDialogComponent.open(dialogService, {
      organizationName,
      customerWord: importer.format.customer,
      customers,
    }).closed,
  );
  if (choice == null) {
    return false;
  }
  importer.onlyCustomer = "all" in choice ? null : choice.customer;
  return true;
}
