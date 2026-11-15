import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { SafeInjectionToken } from "@bitwarden/ui-common";

export interface AssignCollectionsParams {
  ciphers: CipherView[];
  organizationId: OrganizationId;
  availableCollections: CollectionView[];
  activeCollection?: CollectionView;
  isSingleCipherAdmin?: boolean;
  /** Keykeeper: shown at the top of the dialog when selected items were left out of `ciphers`. */
  notice?: string;
}

export const AssignCollectionsResult = {
  Saved: "saved",
  Canceled: "canceled",
} as const;

export type AssignCollectionsResult =
  (typeof AssignCollectionsResult)[keyof typeof AssignCollectionsResult];

export interface AssignCollectionsDialogRef {
  open(params: AssignCollectionsParams): Promise<AssignCollectionsResult>;
}

export const ASSIGN_COLLECTIONS_DIALOG = new SafeInjectionToken<AssignCollectionsDialogRef>(
  "ASSIGN_COLLECTIONS_DIALOG",
);
