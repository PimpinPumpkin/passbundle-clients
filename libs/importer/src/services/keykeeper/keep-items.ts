// Keykeeper: takes items out of an import and renumbers every folder and
// shared folder link to the items that stay, so each keeps its own folder,
// and links to an item taken out go with it. Upstream filtered the items
// alone, which left the links pointing at the old positions: with an
// organization's policy against cards, the items after a card went into
// the wrong folders.

import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { ImportResult } from "../../models/import-result";

export function keepItems(result: ImportResult, keep: (cipher: CipherView) => boolean): void {
  const at: number[] = [];
  let next = 0;
  const kept = result.ciphers.filter((cipher, i) => {
    const k = keep(cipher);
    at[i] = k ? next++ : -1;
    return k;
  });
  if (kept.length === result.ciphers.length) {
    return;
  }
  result.ciphers = kept;
  const renumber = (links: [number, number][]): [number, number][] =>
    links.filter(([item]) => at[item] >= 0).map(([item, folder]) => [at[item], folder]);
  if (result.collectionRelationships != null) {
    result.collectionRelationships = renumber(result.collectionRelationships);
  }
  if (result.folderRelationships != null) {
    result.folderRelationships = renumber(result.folderRelationships);
  }
}
