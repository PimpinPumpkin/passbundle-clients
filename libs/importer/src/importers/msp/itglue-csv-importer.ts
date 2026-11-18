import { MspCsvImporter } from "./msp-csv-importer";
import { IT_GLUE, PASSPORTAL } from "./msp-formats";

/**
 * Keykeeper: the passwords.csv in Kaseya IT Glue's export of an organization
 * or the entire account (Admin, Export Data). Each IT Glue organization is a
 * folder, with its password folder under it. See msp-formats.ts for the
 * columns and msp-csv-importer.ts for what they become.
 */
export class ITGlueCsvImporter extends MspCsvImporter {
  constructor() {
    super(IT_GLUE, PASSPORTAL);
  }
}
