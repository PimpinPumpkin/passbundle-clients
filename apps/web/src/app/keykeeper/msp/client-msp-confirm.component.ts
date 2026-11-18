import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from "@angular/core";
import { firstValueFrom } from "rxjs";

import { ClientMspStaff, OrganizationUserService } from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { KeykeeperMspApiService } from "./msp-api.service";
import { confirmLine, waitingStaff, who } from "./msp-link";

/**
 * Keykeeper: under an MSP's banner on a client's Members page, the MSP's
 * people waiting for the organization's key, each with their fingerprint
 * phrase (made here from the public key the server gives for their account,
 * staff-fingerprint.ts) and one sentence on comparing it, for the client's
 * own owners and admins to confirm by hand. Confirm sends upstream's confirm
 * request, with the organization's key encrypted to that same public key, the
 * one the phrase was made from. Nothing here confirms anyone on its own
 * (DESIGN.md, "An organization that already uses PassBundle").
 */
@Component({
  selector: "app-keykeeper-client-msp-confirm",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (waiting().length > 0) {
      <section class="tw-mb-2" data-testid="client-msp-waiting">
        <h3 bitTypography="h6" class="tw-mb-1">Waiting for you to confirm them</h3>
        <ul class="tw-m-0 tw-list-none tw-p-0">
          @for (w of waiting(); track w.person.memberId) {
            <li class="tw-py-1" [attr.data-testid]="'client-msp-waiting-' + w.person.email">
              <div bitTypography="body2">{{ name(w.person) }}</div>
              @if (phrases().get(w.person.userId ?? ""); as phrase) {
                <div bitTypography="body2">
                  Fingerprint phrase:
                  <code data-testid="client-msp-waiting-phrase">{{ phrase }}</code>
                </div>
                <div class="tw-text-xs tw-text-muted" data-testid="client-msp-waiting-compare">
                  {{ compare(w.person) }}
                </div>
                @if (w.canConfirm) {
                  <button
                    bitButton
                    buttonType="primary"
                    size="small"
                    type="button"
                    class="tw-mt-1"
                    [disabled]="busy()"
                    [attr.aria-label]="'Confirm ' + w.person.email"
                    (click)="confirm(w.person)"
                  >
                    Confirm
                  </button>
                } @else {
                  <div class="tw-text-xs tw-text-muted">An owner here confirms them.</div>
                }
              } @else {
                <div class="tw-text-xs tw-text-muted">
                  The server gives no key for them yet, so they can't be confirmed. They need to
                  sign in once first.
                </div>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class KeykeeperClientMspConfirmComponent {
  readonly organization = input.required<Organization>();
  /** The MSP's people in the organization, from the banner. */
  readonly staff = input.required<ClientMspStaff[]>();
  /** Someone was confirmed: the member list reads again. */
  readonly confirmed = output<void>();

  protected readonly waiting = computed(() =>
    waitingStaff(this.staff(), { isOwner: this.organization().isOwner }),
  );
  protected readonly phrases = signal<Map<string, string>>(new Map());
  protected readonly busy = signal(false);

  protected readonly name = who;
  protected readonly compare = confirmLine;

  constructor(
    private readonly mspApi: KeykeeperMspApiService,
    private readonly organizationUserService: OrganizationUserService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const people = this.waiting()
        .map((w) => w.person)
        .filter((p) => p.userId != null)
        .map((p) => ({ userId: p.userId!, publicKey: p.publicKey }));
      void this.mspApi.staffPhrases(people).then((phrases) => this.phrases.set(phrases));
    });
  }

  protected async confirm(person: ClientMspStaff) {
    if (person.publicKey == null || person.publicKey === "") {
      return;
    }
    this.busy.set(true);
    try {
      // The key the phrase shown was made from, never a second answer.
      await firstValueFrom(
        this.organizationUserService.confirmUser(
          this.organization(),
          person.memberId,
          Utils.fromB64ToArray(person.publicKey),
        ),
      );
      this.toastService.showToast({ variant: "success", message: `Confirmed ${person.email}` });
      this.confirmed.emit();
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }
}
