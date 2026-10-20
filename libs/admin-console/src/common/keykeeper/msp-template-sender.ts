// Keykeeper: writes an MSP's item templates into its clients. Each copy is an
// ordinary item in the client's Templates collection, encrypted here with that
// client's key by upstream's own code, with the same template id as the source
// and the MSP's name in its definition. The server only records which item
// each copy is and which version of the source it was made from. See
// DESIGN.md, "MSP templates".

import { firstValueFrom } from "rxjs";

import { CollectionAdminView } from "@bitwarden/common/admin-console/models/collections";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CollectionId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType, SecureNoteType } from "@bitwarden/common/vault/enums";
import {
  newTemplateDefinitionField,
  TEMPLATE_DEFINITION_FIELD_NAME,
  templateDefinition,
} from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { SecureNoteView } from "@bitwarden/common/vault/models/view/secure-note.view";

import { CollectionAdminService } from "../collections";

import { KeykeeperMspRequests } from "./msp-requests";
import { MspTemplates, TemplateCopy } from "./msp-types";

type NamedClient = { id: string; name: string };

/**
 * Why an item can't be the source of an MSP's template, or null when it can.
 * The server names the source, so every device checks it before copying: it
 * must be a custom template of the MSP's own, never a copy from an MSP, and
 * never in one of the MSP's clients, whose template would then reach the
 * others.
 */
export function templateSourceProblem(
  source: CipherView,
  clientIds: Iterable<string>,
): string | null {
  const definition = templateDefinition(source);
  if (definition == null) {
    return "That item isn't a template.";
  }
  if (definition.from != null) {
    return "That template is a copy from an MSP, so it can't be sent on.";
  }
  if (source.organizationId != null && new Set(clientIds).has(source.organizationId)) {
    return "That template is one of your clients' own, so it can't go to the others.";
  }
  return null;
}

/** Whether an item is a copy of this template in this client, which an update may replace. */
function isCopyOf(item: CipherView, templateId: string, clientId: string): boolean {
  const definition = templateDefinition(item);
  return (
    !item.isDeleted &&
    item.organizationId === clientId &&
    definition?.id === templateId &&
    definition.from != null
  );
}

export type SendResult = {
  sent: NamedClient[];
  failed: (NamedClient & { error: string })[];
};

export class KeykeeperTemplateSender {
  constructor(
    private readonly mspApi: KeykeeperMspRequests,
    private readonly cipherService: CipherService,
    private readonly collectionAdminService: CollectionAdminService,
    private readonly accountService: AccountService,
    private readonly syncService: SyncService,
  ) {}

  /**
   * Writes the source's current version into each client, replacing an older
   * copy, and records the copies. A client that fails is reported, and the
   * others still get it.
   */
  async send(
    msp: { id: string; name: string; clients: { id: string }[] },
    source: CipherView,
    clients: NamedClient[],
    state: MspTemplates,
  ): Promise<SendResult> {
    const problem = templateSourceProblem(
      source,
      msp.clients.map((c) => c.id),
    );
    const definition = templateDefinition(source);
    if (problem != null || definition == null) {
      throw new Error(problem ?? "That item isn't a template.");
    }
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const items = new Map(
      (await this.cipherService.getAllDecrypted(userId)).map((c) => [c.id, c] as const),
    );
    const revision = source.revisionDate.toISOString();
    const result: SendResult = { sent: [], failed: [] };
    const copies: TemplateCopy[] = [];
    for (const client of clients) {
      try {
        const recorded = state.copies.find(
          (c) => c.organizationId === client.id && c.templateId === definition.id,
        );
        const existing = recorded ? items.get(recorded.cipherId) : undefined;
        // Only ever replace a copy of this template: the server names the item.
        const live =
          existing != null && isCopyOf(existing, definition.id, client.id) ? existing : undefined;
        const copy = live ?? new CipherView();
        copy.type = CipherType.SecureNote;
        copy.secureNote = new SecureNoteView();
        copy.secureNote.type = SecureNoteType.Generic;
        copy.name = source.name;
        copy.notes = source.notes;
        copy.fields = [
          ...source.fields
            .filter((f) => f.name !== TEMPLATE_DEFINITION_FIELD_NAME)
            .map((f) => {
              const field = new FieldView();
              field.name = f.name;
              field.value = f.value;
              field.type = f.type;
              return field;
            }),
          newTemplateDefinitionField(definition.base, definition.id, msp.name),
        ];
        let saved: CipherView;
        if (live) {
          saved = await this.cipherService.updateWithServer(copy, userId, undefined, true);
        } else {
          copy.organizationId = client.id as OrganizationId;
          copy.collectionIds = [
            (await this.templatesCollection(msp.id, client.id, state, userId)) as CollectionId,
          ];
          saved = await this.cipherService.createWithServer(copy, userId, true);
        }
        copies.push({ organizationId: client.id, cipherId: saved.id, sourceRevision: revision });
        result.sent.push(client);
      } catch (e) {
        result.failed.push({ ...client, error: errorMessage(e) });
      }
    }
    if (copies.length > 0) {
      await this.mspApi.recordTemplateCopies(msp.id, definition.id, copies);
      await this.syncService.fullSync(true);
    }
    return result;
  }

  /**
   * Moves copies to the trash in each client, for when the MSP stops sending a
   * template. Items that aren't copies from an MSP are left alone, whatever
   * the server listed.
   */
  async removeCopies(copyIds: string[]): Promise<void> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const items = new Map(
      (await this.cipherService.getAllDecrypted(userId)).map((c) => [c.id, c] as const),
    );
    for (const id of copyIds) {
      const item = items.get(id);
      if (item != null && item.organizationId != null && templateDefinition(item)?.from != null) {
        await this.cipherService.softDeleteWithServer(id, userId, true);
      }
    }
  }

  /** The client's Templates collection, made the first time and whenever the client deleted it. */
  private async templatesCollection(
    mspId: string,
    orgId: string,
    state: MspTemplates,
    userId: UserId,
  ): Promise<string> {
    const recorded = state.collections[orgId];
    if (recorded != null) {
      const collections = await firstValueFrom(
        this.collectionAdminService.collectionAdminViews$(orgId, userId),
      );
      if (collections.some((c) => c.id === recorded)) {
        return recorded;
      }
    }
    const view = new CollectionAdminView({
      id: undefined as unknown as CollectionId,
      organizationId: orgId as OrganizationId,
      name: "Templates",
    });
    const created = await this.collectionAdminService.create(view, userId);
    await this.mspApi.setTemplatesCollection(mspId, orgId, created.id);
    state.collections[orgId] = created.id;
    return created.id;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof ErrorResponse
    ? e.getSingleMessage()
    : e instanceof Error
      ? e.message
      : String(e);
}
