import { MspCsvImporter } from "./msp-csv-importer";
import { IT_GLUE, PASSPORTAL } from "./msp-formats";

/**
 * Keykeeper: N-able Passportal's CSV export of passwords (Settings, Import /
 * Export, Export, Passwords, with headers), or of My Vault, which has no
 * client. Each client is a folder, with Passportal's folders under it. See
 * msp-formats.ts for the columns and msp-csv-importer.ts for what they become.
 */
export class PassportalCsvImporter extends MspCsvImporter {
  constructor() {
    super(PASSPORTAL, IT_GLUE);
  }
}
