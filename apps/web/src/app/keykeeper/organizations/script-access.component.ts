import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  copyOf,
  KeykeeperScriptCopies,
  KeykeeperScriptKeys,
  revisionText,
  ScriptReadView,
  ScriptTokenView,
} from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { SyncService } from "@bitwarden/common/platform/sync";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogService, ToastService } from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";

import { SharedModule } from "../../shared";
import { KeykeeperConfirmChangeService } from "../confirm-change/confirm-change.service";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperScriptTokenDialogComponent } from "./script-token-dialog.component";

/** A token just made, shown once. */
type Made = { name: string; tokenString: string; firstItem: string };

/**
 * Keykeeper: script access on an organization's Settings page, for its owners
 * and admins and its MSP's admins (the server answers no one else, and the
 * section stays hidden). Tokens are made here: the seed and token key never
 * leave this browser except in the token string shown once. Making one asks
 * the person to confirm it's them first. See docs/script-access.md in the
 * meta repo.
 */
@Component({
  selector: "app-keykeeper-script-access",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (tokens(); as list) {
      <section data-testid="script-access">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Script access</h1>
        <p bitTypography="body1">
          A token lets your RMM's scripts read chosen credentials when they run, instead of storing
          them in the RMM. It reads only the fields you grant it, expires, and every read is listed
          here. The server can't read what it gets: it's encrypted with a key only the token has.
        </p>

        @if (made(); as m) {
          <bit-callout type="success" title="Copy the token now" data-testid="script-token-made">
            <p class="tw-mb-2">
              This is the only time it's shown. Put it in your RMM as a secret variable named
              PASSBUNDLE_TOKEN.
            </p>
            <pre
              class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
              data-testid="script-token-string"
              >{{ m.tokenString }}</pre>
            <p class="tw-mb-1">In a PowerShell script:</p>
            <pre
              class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
              data-testid="script-token-usage"
              >{{ usage(m) }}</pre>
            <p class="tw-mb-2 tw-text-sm" data-testid="script-token-signing">
              The module isn't signed yet. RMMs usually run scripts with an execution policy that
              allows it; if yours doesn't, run the script with -ExecutionPolicy Bypass.
            </p>
            <div class="tw-flex tw-gap-2">
              <button bitButton buttonType="primary" type="button" (click)="copy(m.tokenString)">
                Copy token
              </button>
              <button bitButton buttonType="secondary" type="button" (click)="made.set(null)">
                Done
              </button>
            </div>
          </bit-callout>
        }

        @if (list.length === 0) {
          <p bitTypography="body2" class="tw-text-muted">No tokens yet.</p>
        } @else {
          <bit-table>
            <ng-container header>
              <tr>
                <th bitCell>Token</th>
                <th bitCell>Reads</th>
                <th bitCell>Expires</th>
                <th bitCell>Last used</th>
                <th bitCell></th>
              </tr>
            </ng-container>
            <ng-template body>
              @for (t of list; track t.id) {
                <tr bitRow [attr.data-testid]="'script-token-' + t.name">
                  <td bitCell>
                    {{ t.name }}
                    @if (status(t); as s) {
                      <span bitBadge [variant]="s.variant" class="tw-ml-2">{{ s.label }}</span>
                    }
                  </td>
                  <td bitCell>{{ granted(t) }}</td>
                  <td bitCell>{{ t.expiresAt | date: "mediumDate" }}</td>
                  <td bitCell>
                    @if (t.lastUsedAt) {
                      {{ t.lastUsedAt | date: "medium" }} from {{ t.lastUsedIp }}
                    } @else {
                      Never
                    }
                  </td>
                  <td bitCell class="tw-whitespace-nowrap tw-text-right">
                    <button
                      type="button"
                      bitLink
                      class="tw-mr-3"
                      [attr.aria-label]="'Reads of ' + t.name"
                      (click)="showReads(t)"
                    >
                      Reads
                    </button>
                    @if (!t.revokedAt) {
                      <button
                        type="button"
                        bitLink
                        [attr.aria-label]="'Revoke ' + t.name"
                        (click)="revoke(t)"
                      >
                        Revoke
                      </button>
                    }
                  </td>
                </tr>
              }
            </ng-template>
          </bit-table>
        }

        @if (reads(); as r) {
          <div class="tw-mt-4" data-testid="script-token-reads">
            <h3 bitTypography="h5">Reads of {{ r.token.name }}</h3>
            @if (r.reads.length === 0) {
              <p bitTypography="body2">None yet.</p>
            } @else {
              <ul class="tw-m-0 tw-list-none tw-p-0 tw-text-sm">
                @for (read of r.reads; track $index) {
                  <li>
                    {{ read.at | date: "medium" }}, {{ read.ip }}:
                    {{
                      read.allowed
                        ? "read " + itemName(read.itemId)
                        : "refused (" + read.reason + ")"
                    }}
                  </li>
                }
              </ul>
            }
          </div>
        }

        <button bitButton buttonType="primary" type="button" class="tw-mt-4" (click)="newToken()">
          New token
        </button>
      </section>
    }
  `,
})
export class KeykeeperScriptAccessComponent {
  readonly organizationId = input.required<string>();

  /** Null while loading, or for someone the server doesn't answer. */
  protected readonly tokens = signal<ScriptTokenView[] | null>(null);
  protected readonly made = signal<Made | null>(null);
  protected readonly reads = signal<{ token: ScriptTokenView; reads: ScriptReadView[] } | null>(
    null,
  );
  private readonly items = signal<CipherView[]>([]);
  private readonly keys = new KeykeeperScriptKeys();
  private readonly copies: KeykeeperScriptCopies;
  private readonly serverUrl = signal("");

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly cipherService: CipherService,
    private readonly keyService: KeyService,
    private readonly accountService: AccountService,
    private readonly environmentService: EnvironmentService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
    private readonly syncService: SyncService,
    private readonly confirmChange: KeykeeperConfirmChangeService,
    encryptService: EncryptService,
  ) {
    this.copies = new KeykeeperScriptCopies(encryptService);
    effect(() => void this.load(this.organizationId()));
  }

  private async load(orgId: string) {
    try {
      const environment = await firstValueFrom(this.environmentService.environment$);
      this.serverUrl.set(environment.getWebVaultUrl() ?? "");
      this.tokens.set(await this.api.scriptTokens(orgId));
    } catch {
      // Not shown to anyone the server won't tell.
      this.tokens.set(null);
    }
  }

  private async userId() {
    return firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
  }

  private async orgKey(orgId: string): Promise<SymmetricCryptoKey | undefined> {
    const keys = await firstValueFrom(this.keyService.orgKeys$(await this.userId()));
    return keys?.[orgId as OrganizationId];
  }

  protected granted(t: ScriptTokenView): string {
    const live = t.grants.filter((g) => !g.itemDeleted);
    return live.length === 1 ? "1 item" : `${live.length} items`;
  }

  protected status(t: ScriptTokenView): { label: string; variant: "danger" | "warning" } | null {
    if (t.revokedAt) {
      return { label: "Revoked", variant: "danger" };
    }
    if (new Date(t.expiresAt).getTime() <= Date.now()) {
      return { label: "Expired", variant: "danger" };
    }
    // Keykeeper: a token works only while whoever made it manages the organization.
    if (t.creatorLostAccess) {
      return { label: "Stopped: its maker left", variant: "danger" };
    }
    if (new Date(t.expiresAt).getTime() - Date.now() < 14 * 86_400_000) {
      return { label: "Expires soon", variant: "warning" };
    }
    if (t.grants.some((g) => !g.upToDate && !g.itemDeleted)) {
      return { label: "Updating", variant: "warning" };
    }
    return null;
  }

  protected itemName(itemId: string | null): string {
    return this.items().find((i) => i.id === itemId)?.name ?? "an item";
  }

  protected usage(m: Made): string {
    return [
      `Invoke-WebRequest "${this.serverUrl()}/api/keykeeper/script/PassBundle.psm1" -OutFile PassBundle.psm1`,
      "Import-Module .\\PassBundle.psm1",
      `$credential = Get-PassBundleCredential -Item "${m.firstItem}"`,
    ].join("\n");
  }

  /**
   * The organization's items this browser has. Items saved from the Admin
   * Console reach it at the next sync, so sync first (nothing happens when
   * nothing changed).
   */
  private async organizationItems(orgId: string): Promise<CipherView[]> {
    try {
      await this.syncService.fullSync(false);
    } catch {
      // What this browser already has will do.
    }
    const all = await this.cipherService.getAllDecrypted(await this.userId());
    return all.filter((c) => c.organizationId === orgId && !c.isDeleted);
  }

  protected async newToken() {
    const orgId = this.organizationId();
    this.items.set(await this.organizationItems(orgId));
    const choice = await firstValueFrom(
      KeykeeperScriptTokenDialogComponent.open(this.dialogService, { items: this.items() }).closed,
    );
    if (choice == null) {
      return;
    }
    await this.attempt(async () => {
      const orgKey = await this.orgKey(orgId);
      if (orgKey == null) {
        throw new Error(
          "This browser doesn't have the organization's key yet. Reload and try again.",
        );
      }
      const { id, seed } = this.keys.newToken();
      const tokenKey = new SymmetricCryptoKey(await this.keys.tokenKey(seed));
      const grants = [];
      for (const { item, spec } of choice.grants) {
        grants.push({
          itemId: item.id,
          copy: await this.copies.encryptCopy(copyOf(id, item, spec), tokenKey),
          revision: revisionText(item.revisionDate),
          sealedSpec: await this.copies.sealSpec(spec, orgKey),
        });
      }
      const token = {
        id,
        name: choice.name,
        expiresAt: choice.expiresAt,
        networks: choice.networks,
        authHash: await this.keys.authHash(seed),
        sealedKey: await this.copies.sealTokenKey(await this.keys.tokenKey(seed), orgKey),
        grants,
      };
      const created = await this.confirmChange.send("keykeeperConfirmScriptToken", (verification) =>
        this.api.createScriptToken(orgId, token, verification),
      );
      if (created == null) {
        return;
      }
      this.made.set({
        name: choice.name,
        tokenString: this.keys.tokenString(id, seed),
        firstItem: choice.grants[0].item.name,
      });
      await this.load(orgId);
    });
  }

  protected async revoke(t: ScriptTokenView) {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Revoke ${t.name}?`,
      content: "Scripts using it stop working right away, and its copies are deleted.",
      acceptButtonText: "Revoke",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    await this.attempt(async () => {
      await this.api.revokeScriptToken(this.organizationId(), t.id);
      this.toastService.showToast({ variant: "success", message: `Revoked ${t.name}` });
      await this.load(this.organizationId());
    });
  }

  protected async showReads(t: ScriptTokenView) {
    if (this.items().length === 0) {
      this.items.set(await this.organizationItems(this.organizationId()));
    }
    await this.attempt(async () => {
      this.reads.set({ token: t, reads: await this.api.scriptReads(this.organizationId(), t.id) });
    });
  }

  protected copy(text: string) {
    this.platformUtilsService.copyToClipboard(text);
    this.toastService.showToast({ variant: "success", message: "Copied the token" });
  }

  private async attempt(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      const message =
        e instanceof ErrorResponse
          ? e.getSingleMessage()
          : e instanceof Error
            ? e.message
            : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
