import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { FamilyLinkParts, readFamilyLink } from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { SyncService } from "@bitwarden/common/platform/sync";
import {
  AsyncActionsModule,
  ButtonModule,
  CalloutModule,
  LinkModule,
  TypographyModule,
} from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { LegacyCompatKeyService } from "@bitwarden/legacy-crypto";

import { FamilyJoined, FamilyLinkInfo, KeykeeperFamilyLinkService } from "./family-link.service";

/** The one sentence for every link that doesn't work, as the server says it. */
export const LINK_DOESNT_WORK = "This invite link doesn't work. Ask whoever sent it for a new one.";

type State =
  | { kind: "loading" }
  | { kind: "bad" }
  | { kind: "signedOut"; info: FamilyLinkInfo }
  | { kind: "locked"; info: FamilyLinkInfo }
  | { kind: "ready"; info: FamilyLinkInfo }
  | { kind: "joined"; joined: FamilyJoined; phrase: string | null };

/** Who invited them, in the join page's words. */
export function invitedLine(info: FamilyLinkInfo): string {
  return info.invitedBy
    ? `${info.invitedBy} invited you to join ${info.organizationName}.`
    : `You're invited to join ${info.organizationName}.`;
}

/**
 * Keykeeper: the page a family's invite link opens (DESIGN.md, "A family's
 * invite link"). It says the family's name and who made the link, and nothing
 * else, then asks the person to sign in or create an account with any email
 * address, and to join. Joining sends the link's token and a proof made with
 * its join secret, which never leaves this browser. The address is kept while
 * they sign in (deepLinkGuard on the route), so they come back here.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncActionsModule,
    ButtonModule,
    CalloutModule,
    LinkModule,
    RouterLink,
    TypographyModule,
  ],
  template: `
    <main class="tw-mx-auto tw-mt-12 tw-max-w-lg tw-px-4" data-testid="family-join">
      @switch (state().kind) {
        @case ("loading") {
          <p bitTypography="body1">Checking the link…</p>
        }
        @case ("bad") {
          <h1 bitTypography="h2">Invite link</h1>
          <p bitTypography="body1" data-testid="family-join-bad">{{ doesntWork }}</p>
        }
        @case ("signedOut") {
          <h1 bitTypography="h2">Join {{ info()?.organizationName }}</h1>
          <p bitTypography="body1" data-testid="family-join-invited">{{ invited() }}</p>
          <p bitTypography="body1">
            Sign in, or create an account with any email address. You come back here after.
          </p>
          <div class="tw-flex tw-gap-2">
            <a bitButton buttonType="primary" routerLink="/login">Sign in</a>
            <a bitButton buttonType="secondary" routerLink="/signup">Create account</a>
          </div>
        }
        @case ("locked") {
          <h1 bitTypography="h2">Join {{ info()?.organizationName }}</h1>
          <p bitTypography="body1" data-testid="family-join-invited">{{ invited() }}</p>
          <p bitTypography="body1">Unlock your vault to join. You come back here after.</p>
          <a bitButton buttonType="primary" routerLink="/lock">Unlock</a>
        }
        @case ("ready") {
          <h1 bitTypography="h2">Join {{ info()?.organizationName }}</h1>
          <p bitTypography="body1" data-testid="family-join-invited">{{ invited() }}</p>
          <p bitTypography="body1">
            You'll see what the family shares with you. Your own items stay yours: the family sees
            only what you put in its shared folders.
          </p>
          <button
            bitButton
            buttonType="primary"
            type="button"
            [bitAction]="join"
            data-testid="family-join-button"
          >
            Join {{ info()?.organizationName }}
          </button>
        }
        @case ("joined") {
          @if (joined(); as j) {
            <h1 bitTypography="h2">
              {{ j.status === 2 ? "You're in" : "You asked to join" }} {{ j.organizationName }}
            </h1>
            @if (j.status === 2) {
              <p bitTypography="body1" data-testid="family-join-done">
                You're in {{ j.organizationName }}.
              </p>
            } @else if (j.automatic) {
              <p bitTypography="body1" data-testid="family-join-done">
                An owner's or admin's web vault or extension lets you in when it's open, usually
                within a few minutes. Their shared items then show in your vault.
              </p>
            } @else {
              <p bitTypography="body1" data-testid="family-join-done">
                An owner or admin lets you in. They may ask you to read your fingerprint phrase to
                check it's you.
              </p>
            }
            @if (phrase(); as p) {
              <p bitTypography="body1">
                Your fingerprint phrase:
                <span class="tw-font-mono" data-testid="family-join-phrase">{{ p }}</span>
                (also in Settings, My account)
              </p>
            }
            <a bitButton buttonType="primary" routerLink="/vault">Open your vault</a>
          }
        }
      }
    </main>
  `,
})
export class KeykeeperFamilyJoinComponent implements OnInit {
  protected readonly state = signal<State>({ kind: "loading" });
  protected readonly doesntWork = LINK_DOESNT_WORK;

  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly keyService = inject(KeyService);
  private readonly fingerprints = inject(LegacyCompatKeyService);
  private readonly syncService = inject(SyncService);
  private readonly familyLinks = inject(KeykeeperFamilyLinkService);
  private readonly parts = signal<FamilyLinkParts | null>(null);

  protected info(): FamilyLinkInfo | null {
    const s = this.state();
    return "info" in s ? s.info : null;
  }

  protected invited(): string {
    const info = this.info();
    return info == null ? "" : invitedLine(info);
  }

  protected joined(): FamilyJoined | null {
    const s = this.state();
    return s.kind === "joined" ? s.joined : null;
  }

  protected phrase(): string | null {
    const s = this.state();
    return s.kind === "joined" ? s.phrase : null;
  }

  async ngOnInit() {
    const parts = readFamilyLink(await firstValueFrom(this.route.queryParams));
    this.parts.set(parts);
    const info = parts == null ? null : await this.familyLinks.info(parts);
    if (info == null) {
      this.state.set({ kind: "bad" });
      return;
    }
    const status = await this.authService.getAuthStatus();
    if (status === AuthenticationStatus.Unlocked) {
      this.state.set({ kind: "ready", info });
    } else if (status === AuthenticationStatus.Locked) {
      this.state.set({ kind: "locked", info });
    } else {
      this.state.set({ kind: "signedOut", info });
    }
  }

  protected readonly join = async () => {
    const parts = this.parts();
    if (parts == null) {
      return;
    }
    try {
      const joined = await this.familyLinks.join(parts);
      this.state.set({ kind: "joined", joined, phrase: await this.ownPhrase() });
      await this.syncService.fullSync(true).catch(() => false);
    } catch (e) {
      const message = plainErrorMessage(e);
      if (message === LINK_DOESNT_WORK) {
        this.state.set({ kind: "bad" });
      } else {
        throw e;
      }
    }
  };

  /** This account's fingerprint phrase, from the public key this device derives from its private key. */
  private async ownPhrase(): Promise<string | null> {
    try {
      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      const publicKey = await firstValueFrom(this.keyService.userPublicKey$(userId));
      if (publicKey == null) {
        return null;
      }
      return (await this.fingerprints.getFingerprint(userId, publicKey)).join("-");
    } catch {
      return null;
    }
  }
}
