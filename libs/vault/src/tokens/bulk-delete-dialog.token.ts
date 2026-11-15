import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { UnionOfValues } from "@bitwarden/common/vault/types/union-of-values";
import { SafeInjectionToken } from "@bitwarden/ui-common";

export interface BulkDeleteDialogParams {
  cipherIds?: string[];
  permanent?: boolean;
  organization?: Organization;
  organizations?: Organization[];
  collections?: CollectionView[];
  unassignedCiphers?: string[];
  /**
   * Keykeeper: a sentence to show above the confirmation's own text, for when
   * some of what was selected is left out (how many are skipped, and why).
   */
  notice?: string;
}

export const BulkDeleteDialogResult = {
  Deleted: "deleted",
  Canceled: "canceled",
  // Keykeeper: the server refused partway. Some of it may be deleted, so the
  // list is read again, and the dialog has already said so.
  Failed: "failed",
} as const;

export type BulkDeleteDialogResult = UnionOfValues<typeof BulkDeleteDialogResult>;

export interface BulkDeleteDialogRef {
  open(params: BulkDeleteDialogParams): Promise<BulkDeleteDialogResult>;
}

export const BULK_DELETE_DIALOG = new SafeInjectionToken<BulkDeleteDialogRef>("BULK_DELETE_DIALOG");
