// Keykeeper: what the import screen adds for an import into an organization:
// before anything is saved, the question of where each of the file's folders
// goes (folder-places-dialog.component.ts). What the answer does is
// services/keykeeper/folder-places.ts. DESIGN.md, "Importing from other
// password managers".

import { firstValueFrom, lastValueFrom, Observable } from "rxjs";

import {
  CollectionTypes,
  CollectionView,
} from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { DialogService } from "@bitwarden/components";

import { FolderPlace, FolderPlacer, FolderQuestion } from "../../services/keykeeper/folder-places";

import {
  FolderPlaceChoice,
  KeykeeperFolderPlacesDialogComponent,
  NEW_FOLDER,
} from "./folder-places-dialog.component";

/**
 * The organization's shared folders this person can add items to, by the
 * rule the rest of the web vault uses (CollectionView.canEditItems: create
 * in the folder's grid, managing it, or an admin's access to every item),
 * without anyone's My Items.
 */
export function placeableFolders(
  organization: Organization,
  collections: CollectionView[],
): CollectionView[] {
  return collections
    .filter(
      (c) =>
        c.organizationId === organization.id &&
        c.type !== CollectionTypes.DefaultUserCollection &&
        c.canEditItems(organization),
    )
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "en", { sensitivity: "base" }));
}

/** Whether this person may make shared folders here, by the rule the web vault's New folder uses. */
export function mayMakeFolders(organization: Organization): boolean {
  return !!organization.canCreateNewCollections && !organization.isProviderUser;
}

/**
 * What each folder starts as: the shared folder the file names by id when
 * it's one of this organization's that the person can add to (an
 * organization's own export, imported back), otherwise a new shared folder
 * when they may make one, otherwise the one already here with the name a new
 * one would get, otherwise nothing until they choose.
 */
export function startingChoices(
  question: FolderQuestion,
  existing: CollectionView[],
  mayMake: boolean,
  target: string | null,
): (FolderPlaceChoice | null)[] {
  const choices: (FolderPlaceChoice | null)[] = [];
  for (const folder of question.folders) {
    const sameId = existing.find((c) => folder.id != null && c.id === folder.id);
    const newName = target == null ? folder.name : `${target}/${folder.name}`;
    const sameName = existing.find((c) => c.name === newName);
    choices[folder.index] = sameId?.id ?? (mayMake ? NEW_FOLDER : (sameName?.id ?? null));
  }
  return choices;
}

/**
 * Into an organization, a way to ask where each of the file's folders goes,
 * for ImportService.import; none for an import into Personal or into
 * someone's own My Items. `collections` are the organization's shared
 * folders as the page reads them: every one in its admin console, otherwise
 * the person's own.
 */
export function folderPlacer(
  dialogService: DialogService,
  organization: Organization | undefined,
  target: CollectionView | null | undefined,
  collections: Observable<CollectionView[]>,
): FolderPlacer | undefined {
  if (organization == null || target?.type === CollectionTypes.DefaultUserCollection) {
    return undefined;
  }
  return async (question) => {
    const existing = placeableFolders(organization, await firstValueFrom(collections));
    const mayMake = mayMakeFolders(organization);
    const targetName = target?.name ?? null;
    const answer = await lastValueFrom(
      KeykeeperFolderPlacesDialogComponent.open(dialogService, {
        organizationName: organization.name,
        target: targetName,
        mayMake,
        existing: existing.map((c) => ({ id: c.id, name: c.name })),
        question,
        start: startingChoices(question, existing, mayMake, targetName),
      }).closed,
    );
    if (answer == null) {
      return null;
    }
    return answer.map((choice): FolderPlace => {
      if (choice === NEW_FOLDER && mayMake) {
        return { kind: "new" };
      }
      const collection = existing.find((c) => c.id === choice);
      return collection == null ? { kind: "leave" } : { kind: "existing", collection };
    });
  };
}
