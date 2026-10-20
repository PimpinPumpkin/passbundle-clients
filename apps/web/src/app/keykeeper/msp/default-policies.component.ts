import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { BasePolicyEditDefinition } from "../../admin-console/organizations/policies";
import { SharedModule } from "../../shared";

import { KeykeeperDefaultPolicyDialogComponent } from "./default-policy-dialog.component";
import { KeykeeperMspApiService, MspPolicies } from "./msp-api.service";
import {
  clientList,
  DefaultPolicyRow,
  defaultPolicyRows,
  describePolicyResult,
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
 * clients back on the default. See DESIGN.md, "Default policies".
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
        setting when you change the default, until you use the default there again.
      </p>
      <bit-table>
        <ng-container header>
          <tr>
            <th bitCell>Policy</th>
            <th bitCell>Default</th>
            <th bitCell>Clients with their own setting</th>
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
              </td>
              <td bitCell data-testid="msp-policy-own">
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
                } @empty {
                  <span class="tw-text-muted">None</span>
                }
                @if (isAdmin() && row.own.length > 1) {
                  <button type="button" bitLink (click)="useDefault(row, row.own)">
                    Use default in all {{ row.own.length }}
                  </button>
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
    const saved = await firstValueFrom(
      KeykeeperDefaultPolicyDialogComponent.open(this.dialogService, {
        definition,
        policy: row.default,
        organizationId: this.organizationId(),
        followers,
      }).closed,
    );
    if (saved == null) {
      return;
    }
    const reached = followers.length - saved.keep.length;
    const revokes = REVOKING[row.type as PolicyType];
    if (saved.enabled && !row.default.enabled && revokes && reached > 0) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: `Turn on ${this.nameOf(row.type)} in ${reached === 1 ? "1 client" : reached + " clients"}?`,
        content: `${revokes} MSP staff aren't affected.`,
        acceptButtonText: "Turn it on",
        type: "warning",
      });
      if (!confirmed) {
        return;
      }
    }
    await this.attempt(async () => {
      const result = await this.mspApi.setDefaultPolicy(
        this.mspId(),
        row.type,
        { enabled: saved.enabled, data: saved.data },
        saved.keep,
      );
      this.report(`Saved the default. ${describePolicyResult(result)}`, result.refused.length);
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
