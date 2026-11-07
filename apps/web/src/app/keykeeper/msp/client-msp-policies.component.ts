import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { outputFromObservable, toObservable, toSignal } from "@angular/core/rxjs-interop";
import { catchError, combineLatest, from, of, shareReplay, switchMap } from "rxjs";

import { ClientMspPolicies } from "@bitwarden/admin-console/common";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { CalloutModule } from "@bitwarden/components";

import { KeykeeperMspApiService } from "./msp-api.service";

/** The MSP that requires a policy of this organization, if one does: its name, and why. */
export function requiredBy(
  info: ClientMspPolicies | null | undefined,
  type: number,
): { msp: string; neededBy: string | null } | null {
  const msp = info?.msp?.name;
  const required = info?.required?.find((p) => p.type === type);
  return msp != null && required != null ? { msp, neededBy: required.neededBy ?? null } : null;
}

/**
 * Keykeeper: on a client organization's Policies page, that its MSP sets
 * default policies, how a policy changed here becomes the organization's own,
 * which ones already are, and what a policy the MSP requires for every client
 * means. It tells the page (`loaded`) which policies the MSP requires, which
 * the page then shows as "Required by" the MSP and doesn't let anyone edit.
 * See DESIGN.md, "Default policies" and "Required for every client".
 */
@Component({
  selector: "app-keykeeper-client-msp-policies",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalloutModule],
  template: `
    @if (info()?.msp; as msp) {
      <bit-callout type="info" [title]="null" data-testid="client-msp-policies">
        <p class="tw-mb-0">
          {{ msp.name }} sets default policies for this organization. A policy follows
          {{ msp.name }}'s default until someone changes it here. Then it's this organization's own
          setting, and {{ msp.name }}'s changes to that default skip it.
          @if (ownNames(); as names) {
            Own settings here: {{ names }}.
          }
        </p>
        @if (requiredCount() > 0) {
          <p class="tw-mb-0 tw-mt-2" data-testid="client-msp-required">
            {{ msp.name }} requires
            {{ requiredCount() === 1 ? "a policy" : "some policies" }}
            for every client, marked "Required by {{ msp.name }}". Nobody can change
            {{ requiredCount() === 1 ? "it" : "them" }} here; only {{ msp.name }}'s console does.
            When {{ msp.name }} stops requiring one, this organization keeps the setting and can
            change it here again.
          </p>
        }
      </bit-callout>
    }
  `,
})
export class KeykeeperClientMspPoliciesComponent {
  readonly organization = input.required<Organization>();

  /**
   * Fetched again whenever a policy is saved, so it stays current. Only for
   * people who can open the page (owners, admins, and custom roles that
   * manage policies); the server says "not found" to anyone else, and a
   * refusal would sign them out.
   */
  private readonly info$ = combineLatest([
    toObservable(this.organization),
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => this.policyService.policies$(userId)),
    ),
  ]).pipe(
    switchMap(([org]) =>
      org.canManagePolicies
        ? from(this.mspApi.getClientMspPolicies(org.id)).pipe(catchError(() => of(null)))
        : of(null),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  protected readonly info = toSignal(this.info$, {
    initialValue: null as ClientMspPolicies | null,
  });
  /** What the MSP sets for this organization, each time it's fetched. */
  readonly loaded = outputFromObservable(this.info$);

  protected readonly ownNames = computed(() =>
    (this.info()?.own ?? []).map((p) => p.name).join(", "),
  );
  protected readonly requiredCount = computed(() => this.info()?.required?.length ?? 0);

  constructor(
    private readonly mspApi: KeykeeperMspApiService,
    private readonly accountService: AccountService,
    private readonly policyService: PolicyService,
  ) {}
}
