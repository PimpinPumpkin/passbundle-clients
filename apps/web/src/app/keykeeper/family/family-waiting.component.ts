import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { OrganizationUserService, PendingMember } from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import {
  ButtonModule,
  CalloutModule,
  LinkModule,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";
// eslint-disable-next-line no-restricted-imports
import { LegacyCompatKeyService } from "@bitwarden/legacy-crypto";

import { KeykeeperMspApiService } from "../msp/msp-api.service";
import { KeykeeperMspWorkService } from "../msp/msp-work.service";
import { staffPhrase } from "../msp/staff-fingerprint";

import { KeykeeperFamilyLinkService } from "./family-link.service";

type Waiting = { p: PendingMember; phrase: string | null };

/** What to compare before confirming, for someone waiting to join a family. */
export function familyCompareLine(email: string): string {
  return `Ask ${email} to read the phrase in Settings, My account. If it's the same, confirm them. If it's different, the key this server gave out for them isn't theirs: don't confirm them, and remove them.`;
}

/**
 * Keykeeper: one tap, on a family's Members page. Everyone waiting for the
 * family's key whom this person can confirm, each with their fingerprint
 * phrase (made from the public key the server gives for them and their
 * account id, as "Key fingerprints" says) and a Confirm button, which is
 * upstream's confirm: the family's key encrypted to that public key. And where
 * the family's invite link is, for owners and admins. Nothing shows for an
 * organization that isn't a family. See DESIGN.md, "A family's invite link".
 */
@Component({
  selector: "app-keykeeper-family-waiting",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule, LinkModule, RouterLink, TypographyModule],
  template: `
    @if (family()) {
      <p bitTypography="body2" class="tw-mb-4" data-testid="family-invite-pointer">
        Invite your family with a link or QR code:
        <a bitLink [routerLink]="['/organizations', organization()?.id, 'settings', 'joining']"
          >Invite link</a
        >
      </p>
      @if (waiting().length) {
        <bit-callout
          type="info"
          title="Waiting for you"
          class="tw-mb-4 tw-block"
          data-testid="family-waiting"
        >
          @for (w of waiting(); track w.p.memberId) {
            <div class="tw-mb-3" [attr.data-email]="w.p.email">
              <div class="tw-font-semibold">{{ w.p.email }}</div>
              @if (w.phrase) {
                <div>
                  Fingerprint phrase:
                  <span class="tw-font-mono" data-testid="family-waiting-phrase">{{
                    w.phrase
                  }}</span>
                </div>
                <div bitTypography="helper">{{ compare(w.p.email) }}</div>
              } @else {
                <div bitTypography="helper">
                  This server gives no key for them yet, so they can't be confirmed.
                </div>
              }
              <button
                bitButton
                buttonType="primary"
                type="button"
                size="small"
                class="tw-mt-1"
                [disabled]="!w.phrase || busy()"
                (click)="confirm(w)"
                data-testid="family-waiting-confirm"
              >
                Confirm
              </button>
            </div>
          }
        </bit-callout>
      }
    }
  `,
})
export class KeykeeperFamilyWaitingComponent implements OnInit {
  readonly organization = input<Organization | null>(null);
  readonly confirmed = output<void>();

  protected readonly family = signal(false);
  protected readonly waiting = signal<Waiting[]>([]);
  protected readonly compare = familyCompareLine;
  protected readonly busy = signal(false);

  private readonly familyLinks = inject(KeykeeperFamilyLinkService);
  private readonly api = inject(KeykeeperMspApiService);
  private readonly work = inject(KeykeeperMspWorkService);
  private readonly organizationUserService = inject(OrganizationUserService);
  private readonly fingerprints = inject(LegacyCompatKeyService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit() {
    // Someone the background work let in is no longer waiting.
    this.work.updated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load());
    void this.load();
  }

  private async load() {
    const org = this.organization();
    if (org == null || !(org.isOwner || org.isAdmin)) {
      return;
    }
    // Only a family's owners and admins get an answer here.
    this.family.set((await this.familyLinks.get(org.id)) != null);
    if (!this.family()) {
      return;
    }
    const pending = await this.api.organizationsPending().catch((): PendingMember[] => []);
    const here = pending.filter((p) => p.organizationId === org.id && p.needsTwoStep !== true);
    const waiting: Waiting[] = [];
    for (const p of here) {
      waiting.push({
        p,
        phrase: await staffPhrase(this.fingerprints, { userId: p.userId, publicKey: p.publicKey }),
      });
    }
    this.waiting.set(waiting);
  }

  /** Confirms by hand, with upstream's confirm request: no word that it was automatic. */
  protected async confirm(w: Waiting) {
    const org = this.organization();
    if (org == null || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.organizationUserService.confirmUser(
          org,
          w.p.memberId,
          Utils.fromB64ToArray(w.p.publicKey),
        ),
      );
      this.toastService.showToast({
        variant: "success",
        message: `${w.p.email} is in ${org.name}`,
      });
      this.waiting.update((list) => list.filter((x) => x.p.memberId !== w.p.memberId));
      this.confirmed.emit();
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }
}
