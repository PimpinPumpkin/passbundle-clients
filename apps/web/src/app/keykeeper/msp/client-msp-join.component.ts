import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";

import { LinkPreview } from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperMspRemovedDialogComponent } from "../offboarding/msp-removed-dialog.component";

import { KeykeeperMspApiService } from "./msp-api.service";
import { joinButton, joiningLine, previewSentences, readLinkCode, who } from "./msp-link";

/**
 * Keykeeper: on an organization's Members page, below where "Your MSP" shows,
 * its own owners enter a code an MSP gave them to join the organization to
 * that MSP, or to move it there from the MSP it has now. Before anything
 * changes, the page says which MSP it is and what joining means; only "Join"
 * (or "Move") changes anything. The MSP's people then wait for an owner here
 * to confirm them, under the banner, after comparing fingerprint phrases
 * (DESIGN.md, "An organization that already uses PassBundle").
 */
@Component({
  selector: "app-keykeeper-client-msp-join",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (shown()) {
      <section class="tw-mb-4" data-testid="client-msp-join">
        @if (!open()) {
          <button bitLink type="button" (click)="open.set(true)" data-testid="client-msp-join-open">
            {{ hasMsp() ? "Moving to another MSP? Enter its code" : "Have a code from an MSP?" }}
          </button>
        } @else {
          <bit-callout type="info" [title]="null">
            @if (preview(); as p) {
              <h3 bitTypography="h6" class="tw-mb-2" data-testid="client-msp-join-msp">
                {{ p.current ? "Move to " + p.msp.name + "?" : "Join " + p.msp.name + "?" }}
              </h3>
              @for (sentence of sentences(); track $index) {
                <p class="tw-mb-2" bitTypography="body2">{{ sentence }}</p>
              }
              @if (p.adding.length > 0) {
                <ul class="tw-mb-2 tw-ps-5 tw-list-disc" data-testid="client-msp-join-adding">
                  @for (person of p.adding; track person.email) {
                    <li>{{ line(person) }}</li>
                  }
                </ul>
              }
              <div class="tw-flex tw-gap-2">
                <button
                  bitButton
                  buttonType="primary"
                  type="button"
                  [disabled]="busy()"
                  (click)="join(p)"
                >
                  {{ button(p) }}
                </button>
                <button bitButton buttonType="secondary" type="button" (click)="cancel()">
                  Cancel
                </button>
              </div>
            } @else {
              <p class="tw-mb-2" bitTypography="body2">
                Enter the code your MSP gave you. You'll see which MSP it is, and who it would add,
                before anything changes.
              </p>
              <form class="tw-flex tw-items-end tw-gap-2" (submit)="check($event)">
                <bit-form-field disableMargin class="tw-grow">
                  <bit-label>Code from your MSP</bit-label>
                  <input
                    bitInput
                    type="text"
                    autocomplete="off"
                    [spellcheck]="false"
                    [value]="typed()"
                    (input)="typed.set($any($event.target).value)"
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  />
                </bit-form-field>
                <button bitButton buttonType="primary" type="submit" [disabled]="busy()">
                  Check code
                </button>
                <button bitButton buttonType="secondary" type="button" (click)="cancel()">
                  Cancel
                </button>
              </form>
            }
            @if (problem(); as message) {
              <p class="tw-mb-0 tw-mt-2 tw-text-danger" role="alert">{{ message }}</p>
            }
          </bit-callout>
        }
      </section>
    }
  `,
})
export class KeykeeperClientMspJoinComponent {
  readonly organization = input.required<Organization>();
  /** Whether an MSP manages the organization now, from the banner. */
  readonly hasMsp = input(false);
  /** The organization joined an MSP, or moved: its members and banner read again. */
  readonly joined = output<void>();

  protected readonly open = signal(false);
  protected readonly typed = signal("");
  protected readonly preview = signal<LinkPreview | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** The organization's own owners only, never someone whose place is an MSP's. */
  protected readonly shown = computed(() => {
    const org = this.organization();
    return org.isOwner && !org.keykeeperFromMsp;
  });

  protected readonly sentences = computed(() => {
    const p = this.preview();
    return p == null ? [] : previewSentences(p, this.organization().name);
  });

  protected readonly line = joiningLine;
  protected readonly button = joinButton;

  constructor(
    private readonly mspApi: KeykeeperMspApiService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {}

  protected cancel() {
    this.open.set(false);
    this.typed.set("");
    this.preview.set(null);
    this.problem.set(null);
  }

  protected async check(event: Event) {
    event.preventDefault();
    this.problem.set(null);
    if (readLinkCode(this.typed()) == null) {
      this.problem.set(
        "That isn't a code: it has 24 letters and numbers, in groups of four. Check it with your MSP.",
      );
      return;
    }
    this.busy.set(true);
    try {
      this.preview.set(await this.mspApi.previewLink(this.organization().id, this.typed()));
    } catch (e) {
      this.problem.set(plainErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async join(preview: LinkPreview) {
    this.busy.set(true);
    this.problem.set(null);
    try {
      const result = await this.mspApi.joinWithCode(
        this.organization().id,
        this.typed(),
        preview.current != null,
      );
      const people = preview.adding.map((p) => who(p)).join(", ");
      this.toastService.showToast({
        variant: "success",
        message:
          result.added > 0
            ? `${result.msp.name} now manages ${this.organization().name}. Confirm ${people} below once you've compared their phrases.`
            : `${result.msp.name} now manages ${this.organization().name}.`,
      });
      this.cancel();
      this.joined.emit();
      if (result.moved != null) {
        // What went with the MSP it had, as after removing an MSP.
        this.dialogService.open(KeykeeperMspRemovedDialogComponent, { data: result.moved });
      }
    } catch (e) {
      this.problem.set(plainErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
