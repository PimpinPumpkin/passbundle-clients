import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { DialogService, ToastService } from "@bitwarden/components";

import { BasePolicyEditDefinition } from "../../admin-console/organizations/policies";
import { SharedModule } from "../../shared";

import { KeykeeperDefaultPolicyDialogComponent } from "./default-policy-dialog.component";
import { KeykeeperMspApiService, MspPolicies } from "./msp-api.service";
import {
  allNames,
  clientList,
  clientsRequiringChanges,
  DefaultPolicyRow,
  defaultPolicyRows,
  describePolicyResult,
  rowClientsSummary,
} from "./msp-policies";

/** Turning these on revokes some of a client's members, so the console asks first. */
const REVOKING: Partial<Record<PolicyType, string>> = {
  [PolicyType.TwoFactorAuthentication]:
    "Members who aren't owners or admins and don't use two-step login are revoked until they turn it on.",
  [PolicyType.SingleOrg]:
    "Members who aren't owners or admins and belong to another organization are revoked.",
};

/**
 * Keykeeper: the MSP's default policies in the console. Every client follows
 * them; a client whose policy differs, because someone changed it in that
 * client's admin console, has its own setting, which changing the default
 * skips. MSP admins edit defaults with upstream's own policy forms and can put
 * clients back on the default. A default can be required for every client
 * instead: it reaches clients with their own setting too, and nobody changes
 * it in a client's admin console until it's no longer required. See
 * DESIGN.md, "Default policies" and "Required for every client".
 */
@Component({
  selector: "app-keykeeper-default-policies",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <section class="tw-mb-8" aria-label="Default policies" data-testid="msp-default-policies">
      <h2 bitTypography="h3">Default policies</h2>
      <p bitTypography="body2">
        Every client follows these, including clients you add later. To give one client a different
        setting, change that policy in the client's admin console. That client then keeps its own
        setting when you change the default, until you use the default there again. A policy
        required for every client reaches clients with their own setting too, and nobody can change
        it in a client's admin console until you stop requiring it.
      </p>
      <bit-table>
        <ng-container header>
          <tr>
            <th bitCell>Policy</th>
            <th bitCell>Default</th>
            <th bitCell>Clients</th>
            <th bitCell></th>
          </tr>
        </ng-container>
        <ng-template body>
          @for (row of rows(); track row.type) {
            @let name = nameOf(row.type);
            <tr bitRow [attr.data-testid]="'msp-policy-' + name">
              <td bitCell>{{ name }}</td>
              <td bitCell data-testid="msp-policy-default">
                @if (row.default.enabled) {
                  <span bitBadge variant="success">On</span>
                } @else {
                  <span bitBadge variant="secondary">Off</span>
                }
                @if (row.required) {
                  <span
                    bitBadge
                    variant="primary"
                    startIcon="bwi-lock"
                    class="tw-ml-1"
                    data-testid="msp-policy-required"
                    title="Required for every client"
                    >Required</span
                  >
                }
              </td>
              <td bitCell data-testid="msp-policy-clients">
                <div data-testid="msp-policy-reach">{{ summaryOf(row) }}</div>
                @if (row.required) {
                  @for (client of row.notInStep; track client.id) {
                    <div data-testid="msp-policy-not-in-step">
                      {{ client.name }}: not in step
                      @if (isAdmin()) {
                        <button
                          type="button"
                          bitLink
                          class="tw-ml-2"
                          [attr.aria-label]="'Try ' + name + ' again in ' + client.name"
                          (click)="tryAgain(row, [client])"
                        >
                          Try again
                        </button>
                      }
                    </div>
                  }
                } @else if (row.own.length > 0) {
                  <div data-testid="msp-policy-own">
                    @for (client of row.own; track client.id) {
                      <div>
                        {{ client.name }}
                        @if (isAdmin()) {
                          <button
                            type="button"
                            bitLink
                            class="tw-ml-2"
                            [attr.aria-label]="'Use the default ' + name + ' in ' + client.name"
                            (click)="useDefault(row, [client])"
                          >
                            Use default
                          </button>
                        }
                      </div>
                    }
                    @if (isAdmin() && row.own.length > 1) {
                      <button type="button" bitLink (click)="useDefault(row, row.own)">
                        Use default in all {{ row.own.length }}
                      </button>
                    }
                  </div>
                }
              </td>
              <td bitCell class="tw-text-right">
                @if (isAdmin()) {
                  <button
                    type="button"
                    bitLink
                    [attr.aria-label]="'Edit the default ' + name"
                    (click)="edit(row)"
                  >
                    Edit
                  </button>
                }
              </td>
            </tr>
          }
        </ng-template>
      </bit-table>
    </section>
  `,
})
export class KeykeeperDefaultPoliciesComponent {
  readonly mspId = input.required<string>();
  readonly isAdmin = input.required<boolean>();
  readonly policies = input.required<MspPolicies>();
  /** Upstream's forms for the policies shown, in the admin console's order. */
  readonly definitions = input.required<BasePolicyEditDefinition[]>();
  /** A client the person holds the key for, for upstream's forms. */
  readonly organizationId = input<string | undefined>(undefined);
  /** A default or a client's policies changed. */
  readonly changed = output<void>();

  protected readonly rows = computed(() =>
    defaultPolicyRows(
      this.policies(),
      this.definitions().map((d) => d.type),
    ),
  );

  constructor(
    private readonly mspApi: KeykeeperMspApiService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
    private readonly i18nService: I18nService,
  ) {}

  protected summaryOf(row: DefaultPolicyRow): string {
    return rowClientsSummary(row);
  }

  protected nameOf(type: number): string {
    const definition = this.definitionOf(type);
    return definition ? this.i18nService.t(definition.name) : String(type);
  }

  private definitionOf(type: number) {
    return this.definitions().find((d) => d.type === type);
  }

  protected async edit(row: DefaultPolicyRow) {
    const definition = this.definitionOf(row.type);
    if (definition == null) {
      return;
    }
    const own = new Set(row.own.map((c) => c.id));
    const followers = this.policies()
      .clients.filter((c) => !own.has(c.id))
      .map(({ id, name }) => ({ id, name }));
    const needs = (this.policies().prerequisites ?? [])
      .filter((p) => p.type === row.type)
      .flatMap((p) => p.needs)
      .map((type) => ({
        name: this.nameOf(type),
        on: this.policies().defaults.some((d) => d.type === type && d.enabled),
      }));
    const saved = await firstValueFrom(
      KeykeeperDefaultPolicyDialogComponent.open(this.dialogService, {
        definition,
        policy: row.default,
        organizationId: this.organizationId(),
        followers,
        required: row.required,
        own: row.own,
        hadOwn: row.hadOwn,
        needs,
      }).closed,
    );
    if (saved == null) {
      return;
    }
    const name = this.nameOf(row.type);
    const revokes = REVOKING[row.type as PolicyType];
    if (saved.required) {
      // Before requiring it, or changing what's required: which clients change, by name.
      const changes = clientsRequiringChanges(this.policies(), row.type, saved);
      if (!row.required || changes.length > 0) {
        const revoking =
          revokes && changes.some((c) => !c.enabled)
            ? ` ${revokes} MSP staff aren't affected.`
            : "";
        const confirmed = await this.dialogService.openSimpleDialog({
          title: row.required
            ? `Change ${name} in every client?`
            : `Require ${name} for every client?`,
          content:
            (changes.length === 0
              ? "Every client already has this setting."
              : `This changes it in ${allNames(changes)}.`) +
            revoking +
            (row.required
              ? ""
              : " Nobody can change it in a client's admin console until you stop requiring it."),
          acceptButtonText: row.required ? "Change it" : "Require it",
          type: "warning",
        });
        if (!confirmed) {
          return;
        }
      }
    } else {
      const reached = followers.length - saved.keep.length;
      if (saved.enabled && !row.default.enabled && revokes && reached > 0) {
        const confirmed = await this.dialogService.openSimpleDialog({
          title: `Turn on ${name} in ${reached === 1 ? "1 client" : reached + " clients"}?`,
          content: `${revokes} MSP staff aren't affected.`,
          acceptButtonText: "Turn it on",
          type: "warning",
        });
        if (!confirmed) {
          return;
        }
      }
    }
    await this.attempt(async () => {
      const result = await this.mspApi.setDefaultPolicy(
        this.mspId(),
        row.type,
        { enabled: saved.enabled, data: saved.data },
        saved.keep,
        saved.required,
      );
      let message: string;
      if (saved.required && !row.required) {
        message = `Required for every client. ${describePolicyResult(result)}`;
      } else if (row.required && !saved.required) {
        message = "Stopped requiring it. Every client keeps its setting and follows the default.";
        if (result.changed.length > 0 || result.refused.length > 0) {
          message += ` ${describePolicyResult(result)}`;
        }
      } else {
        message = `Saved the default. ${describePolicyResult(result)}`;
      }
      this.report(message, result.refused.length);
    });
  }

  /** Tries a required default again in clients that refused it. */
  protected async tryAgain(row: DefaultPolicyRow, clients: { id: string; name: string }[]) {
    await this.attempt(async () => {
      const result = await this.mspApi.useDefaultPolicy(
        this.mspId(),
        row.type,
        clients.map((c) => c.id),
      );
      this.report(describePolicyResult(result), result.refused.length);
    });
  }

  protected async useDefault(row: DefaultPolicyRow, clients: { id: string; name: string }[]) {
    const name = this.nameOf(row.type);
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Use the default ${name}?`,
      content: `${clientList(clients)} ${clients.length === 1 ? "loses its" : "lose their"} own setting and ${clients.length === 1 ? "follows" : "follow"} the default from now on.`,
      acceptButtonText: "Use default",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    await this.attempt(async () => {
      const result = await this.mspApi.useDefaultPolicy(
        this.mspId(),
        row.type,
        clients.map((c) => c.id),
      );
      this.report(describePolicyResult(result), result.refused.length);
    });
  }

  private report(message: string, refused: number) {
    this.toastService.showToast({ variant: refused > 0 ? "warning" : "success", message });
    this.changed.emit();
  }

  private async attempt(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      const message = plainErrorMessage(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
