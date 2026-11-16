import { KeykeeperPlanSentence } from "@bitwarden/angular/billing/keykeeper";
import { BitSvg } from "@bitwarden/assets/svg";

import { ReportVariant } from "./report-variant";

export type ReportEntry = {
  title: string;
  description: string;
  route: string;
  icon: BitSvg;
  variant: ReportVariant;
  /** Keykeeper: what the Premium badge says for this report, when it has a sentence of its own. */
  keykeeperSentence?: KeykeeperPlanSentence;
};
