// Keykeeper: the editor's inputs for values the person can't see (DESIGN.md,
// "Folders and permissions"). Someone who can edit an item but not see its
// passwords can't show, overwrite, or clear those values blind: their inputs
// are disabled, and each section writes back with getRawValue(), which keeps
// them as they are.

import { AbstractControl } from "@angular/forms";

import {
  isSecretValue,
  ItemValuePart,
  maySeeSecretsOrNew,
  SecretsLike,
} from "@bitwarden/common/vault/keykeeper/hidden-secrets";

/**
 * Disables each control of a section whose value, named `part.control`, is a
 * secret the person can't see. A new item (no original) is theirs.
 */
export function lockHiddenControls(
  controls: Record<string, AbstractControl>,
  part: ItemValuePart,
  original: SecretsLike | null | undefined,
): void {
  if (maySeeSecretsOrNew(original)) {
    return;
  }
  for (const [name, control] of Object.entries(controls)) {
    if (isSecretValue(`${part}.${name}`)) {
      control.disable({ emitEvent: false });
    }
  }
}
