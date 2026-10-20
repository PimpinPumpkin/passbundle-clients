// Keykeeper: background work, so people get in and clients stay set up
// without anyone opening a console. It confirms members waiting for their org
// key in every organization where the person is an owner or admin and that
// confirms automatically (giving the org key the normal way, encrypted to the
// member's public key), when something the server can't forge vouches for
// them (join-checks.ts), and keeps MSP clients' copies of the MSP's templates
// current. Both need the person's unlocked keys, so this runs in the web vault
// and the browser extension while they're unlocked.
// See DESIGN.md, "Joining", "MSP console", and "MSP templates".

import {
  EMPTY,
  Observable,
  Subject,
  debounceTime,
  firstValueFrom,
  interval,
  merge,
  switchMap,
} from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { templateDefinition } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { OrganizationUserService } from "../organization-user";

import { KeykeeperJoinChecks } from "./join-checks";
import { KeykeeperMspRequests } from "./msp-requests";
import { KeykeeperTemplateSender, templateSourceProblem } from "./msp-template-sender";
import { knownItems, templateRows } from "./msp-template-status";
import { MspDetails, MspTemplates, PendingMember } from "./msp-types";

const CONFIRMED = 2;
/** Waits for a burst of changes, such as a sync, to settle. */
const SETTLE_MS = 3000;
/** How often to look again while unlocked. */
const EVERY_MS = 5 * 60 * 1000;

export type ConfirmResult = { confirmed: number; failed: string[] };

/** Someone an app let in on its own, for the notice on that device. */
export type LetIn = { email: string; organizationName: string };

const message = (e: unknown) =>
  e instanceof ErrorResponse ? e.getSingleMessage() : e instanceof Error ? e.message : String(e);

export class KeykeeperMspWork {
  private running: Promise<string[]> | null = null;
  private rerun = false;
  /**
   * Template copies that failed this session, by template, client, and source
   * version. Automatic runs skip them so a lasting failure can't repeat
   * forever; a run with `retry` tries them again.
   */
  private readonly failed = new Set<string>();
  private readonly updated = new Subject<void>();
  /** Emits after members were confirmed or template copies written. */
  readonly updated$: Observable<void> = this.updated.asObservable();
  private readonly letIn = new Subject<LetIn>();
  /** Each person let in on its own, so the device can say so. */
  readonly letIn$: Observable<LetIn> = this.letIn.asObservable();

  constructor(
    private readonly requests: KeykeeperMspRequests,
    private readonly sender: KeykeeperTemplateSender,
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly cipherService: CipherService,
    private readonly organizationService: OrganizationService,
    private readonly organizationUserService: OrganizationUserService,
    private readonly syncService: SyncService,
    private readonly joinChecks: KeykeeperJoinChecks,
  ) {}

  /**
   * Runs whenever the person unlocks, whenever their items change, and every
   * few minutes while unlocked, so someone who accepts an invitation gets in
   * soon even if nothing else happens. (The extension's background can sleep,
   * so it also sets a browser alarm; see apps/browser/src/keykeeper/msp-work.ts.)
   */
  start() {
    this.accountService.activeAccount$
      .pipe(
        switchMap((account) =>
          account == null
            ? EMPTY
            : this.authService
                .authStatusFor$(account.id)
                .pipe(
                  switchMap((status) =>
                    status === AuthenticationStatus.Unlocked
                      ? merge(this.cipherService.ciphers$(account.id), interval(EVERY_MS))
                      : EMPTY,
                  ),
                ),
        ),
        debounceTime(SETTLE_MS),
      )
      .subscribe(() => void this.run());
  }

  /**
   * Confirms waiting members and brings templates up to date in every MSP the
   * person is staff of. One run at a time; a request during one runs once
   * more after it. Never throws; resolves to what failed, in sentences.
   */
  async run(retry = false): Promise<string[]> {
    if (retry) {
      this.failed.clear();
    }
    if (this.running != null) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.runOnce()
      .catch((e: unknown) => [message(e)])
      .finally(() => {
        this.running = null;
        if (this.rerun) {
          this.rerun = false;
          void this.run();
        }
      });
    return this.running;
  }

  private async runOnce(): Promise<string[]> {
    if ((await this.authService.getAuthStatus()) !== AuthenticationStatus.Unlocked) {
      return [];
    }
    const failures: string[] = [];
    let changed = false;
    // confirmWaiting tells listeners itself when it confirmed someone.
    failures.push(...(await this.confirmWaiting()).failed);
    for (const summary of await this.requests.list()) {
      if (summary.role === "admin") {
        const templates = await this.updateTemplates(summary.id);
        changed ||= templates.wrote;
        failures.push(...templates.failures);
      }
    }
    if (changed) {
      this.updated.next();
    }
    return failures;
  }

  /**
   * Confirms everyone waiting in the organizations where this person is an
   * owner or admin and that confirm automatically, when something the server
   * can't forge vouches for them. The rest are left for an admin.
   */
  private async confirmWaiting(): Promise<ConfirmResult> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const organizations = await firstValueFrom(this.organizationService.organizations$(userId));
    // Only owners and admins confirm; don't ask the server otherwise.
    if (!organizations.some((o) => o.isOwner || o.isAdmin)) {
      return { confirmed: 0, failed: [] };
    }
    return this.confirm((await this.requests.organizationsPending()).filter((p) => p.autoConfirm));
  }

  /**
   * Confirms the memberships waiting in an MSP's clients that this person can
   * confirm, when the MSP console opens, on the same terms as the background.
   * The rest are left for an admin's Confirm on their client's Members page,
   * which shows the person's fingerprint.
   */
  async confirmPending(mspId: string): Promise<ConfirmResult> {
    return this.confirm((await this.requests.pending(mspId)).filter((p) => p.autoConfirm));
  }

  /**
   * Confirms, with upstream's confirm request, those of `pending` that this
   * device may let in on its own (join-checks.ts). A member someone else
   * confirmed in the meantime fails and is reported.
   */
  private async confirm(waiting: PendingMember[]): Promise<ConfirmResult> {
    if (waiting.length === 0) {
      return { confirmed: 0, failed: [] };
    }
    // Org keys for organizations created or joined since the last sync.
    await this.syncService.fullSync(false);
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const organizations = await firstValueFrom(this.organizationService.organizations$(userId));
    const pending = await this.joinChecks.onItsOwn(userId, waiting);
    const result: ConfirmResult = { confirmed: 0, failed: [] };
    for (const p of pending) {
      const organization = organizations.find((o) => o.id === p.organizationId);
      if (organization == null) {
        continue;
      }
      try {
        await firstValueFrom(
          this.organizationUserService.confirmUser(
            organization,
            p.memberId,
            Utils.fromB64ToArray(p.publicKey),
          ),
        );
        result.confirmed++;
        this.letIn.next({ email: p.email, organizationName: organization.name });
      } catch (e) {
        result.failed.push(`${p.email} in ${organization.name}: ${message(e)}`);
      }
    }
    if (result.confirmed > 0) {
      this.updated.next();
    }
    return result;
  }

  /**
   * Writes the current version of each template the person can see into
   * every client that's behind, and moves duplicate copies (from two devices
   * writing at once) to the client's trash.
   */
  private async updateTemplates(mspId: string): Promise<{ wrote: boolean; failures: string[] }> {
    const [msp, state] = await Promise.all([
      this.requests.get(mspId),
      this.requests.getTemplates(mspId),
    ]);
    const outcome = { wrote: false, failures: [] as string[] };
    if (state.templates.length === 0) {
      return outcome;
    }
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const items = await this.cipherService.getAllDecrypted(userId);
    const rows = templateRows(
      state,
      msp.clients.map(({ id, name }) => ({ id, name })),
      knownItems(items),
    );
    for (const row of rows) {
      const source = items.find((c) => c.id === row.sourceCipherId);
      if (!row.sourceVisible || source == null) {
        continue;
      }
      const problem = templateSourceProblem(
        source,
        msp.clients.map((c) => c.id),
      );
      if (problem != null) {
        // Said once a session, like a failed copy.
        if (!this.failed.has(`${row.templateId}:source`)) {
          this.failed.add(`${row.templateId}:source`);
          outcome.failures.push(`${source.name}: ${problem}`);
        }
        continue;
      }
      const revision = source.revisionDate.toISOString();
      const key = (clientId: string) => `${row.templateId}:${clientId}:${revision}`;
      const behind = keyed(msp, row.behind).filter((c) => !this.failed.has(key(c.id)));
      if (behind.length > 0) {
        const result = await this.sender.send(msp, source, behind, state);
        for (const f of result.failed) {
          this.failed.add(key(f.id));
          outcome.failures.push(`${source.name} in ${f.name}: ${f.error}`);
        }
        outcome.wrote ||= result.sent.length > 0;
      }
    }
    const extras = duplicateCopies(state, items);
    if (extras.length > 0) {
      await this.sender.removeCopies(extras);
      outcome.wrote = true;
    }
    return outcome;
  }
}

/** Clients whose key the person holds, so a copy can be encrypted for them. */
function keyed(msp: MspDetails, clients: { id: string; name: string }[]) {
  const confirmed = new Set(
    msp.clients.filter((c) => c.you?.status === CONFIRMED).map((c) => c.id),
  );
  return clients.filter((c) => confirmed.has(c.id));
}

/**
 * Copies of the MSP's templates that aren't the recorded copy in their client:
 * the result of two devices writing a copy at the same moment. Only live items
 * in a client with a recorded, live copy of the same template count.
 */
export function duplicateCopies(state: MspTemplates, items: CipherView[]): string[] {
  const live = new Set(items.filter((c) => !c.isDeleted).map((c) => c.id));
  const extras: string[] = [];
  for (const copy of state.copies) {
    if (!live.has(copy.cipherId)) {
      continue;
    }
    for (const item of items) {
      if (
        item.id !== copy.cipherId &&
        !item.isDeleted &&
        item.organizationId === copy.organizationId &&
        templateDefinition(item)?.id === copy.templateId &&
        templateDefinition(item)?.from != null
      ) {
        extras.push(item.id);
      }
    }
  }
  return extras;
}
