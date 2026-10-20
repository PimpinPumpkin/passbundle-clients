import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";

import { PendingMember } from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { CalloutModule } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";
import { KeykeeperMspWorkService } from "../msp/msp-work.service";

/**
 * Keykeeper: opening an organization's Members page lets in anyone waiting
 * whom this person can confirm (as opening the MSP console does), and tells
 * the page to reload its list when someone got in. It also says who can't be
 * confirmed until they turn on two-step login, which the organization
 * requires; upstream shows them only as needing confirmation. See DESIGN.md,
 * "Joining".
 */
@Component({
  selector: "app-keykeeper-members-joining",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalloutModule],
  template: `
    @if (waitingForTwoStep().length) {
      <bit-callout
        type="info"
        title="Waiting for two-step login"
        class="tw-mb-4 tw-block"
        data-testid="members-two-step-waiting"
      >
        This organization requires two-step login, so {{ names() }} can't be confirmed until they
        turn it on. Their vault tells them, and they're confirmed as usual once it's on.
      </bit-callout>
    }
  `,
})
export class KeykeeperMembersJoiningComponent implements OnInit {
  readonly organization = input<Organization | null>(null);
  readonly joined = output<void>();

  protected readonly waitingForTwoStep = signal<PendingMember[]>([]);
  protected readonly names = computed(() =>
    this.waitingForTwoStep()
      .map((p) => p.email)
      .join(", "),
  );

  private readonly work = inject(KeykeeperMspWorkService);
  private readonly api = inject(KeykeeperMspApiService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.work.updated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.joined.emit();
      void this.findWaitingForTwoStep();
    });
    void this.work.run().finally(() => this.findWaitingForTwoStep());
  }

  private async findWaitingForTwoStep() {
    const org = this.organization();
    if (org == null || !(org.isOwner || org.isAdmin)) {
      return;
    }
    const pending = await this.api.organizationsPending().catch((): PendingMember[] => []);
    this.waitingForTwoStep.set(
      pending.filter((p) => p.organizationId === org.id && p.needsTwoStep === true),
    );
  }
}
