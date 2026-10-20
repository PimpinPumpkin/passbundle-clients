import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  ViewContainerRef,
  signal,
  viewChild,
} from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";
import { firstValueFrom, map, switchMap } from "rxjs";

import { PolicyResponse } from "@bitwarden/common/admin-console/models/response/policy.response";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { DIALOG_DATA, DialogRef, DialogService } from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";

import {
  BasePolicyEditComponent,
  BasePolicyEditDefinition,
} from "../../admin-console/organizations/policies";
import { SharedModule } from "../../shared";

import { MspPolicy } from "./msp-api.service";

export type DefaultPolicyDialogData = {
  definition: BasePolicyEditDefinition;
  policy: MspPolicy;
  /**
   * A client the person holds the key for. Some of upstream's policy forms
   * read their organization, and one encrypts a name with its key for its
   * request; the MSP's default ignores both.
   */
  organizationId?: string;
  /** The clients that follow this default. */
  followers: { id: string; name: string }[];
};

/**
 * The default as saved: on or off, with its options, and the clients that
 * follow it but stay as they are this time.
 */
export type DefaultPolicyDialogResult = { enabled: boolean; data: any; keep: string[] };

/**
 * Keykeeper: edits one of an MSP's default policies with upstream's own form
 * for that policy, so its options, wording, and checks match a client's admin
 * console. Saving returns the policy; the caller sends it to the MSP.
 */
@Component({
  selector: "app-keykeeper-default-policy-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <form
      [formGroup]="formGroup"
      [bitSubmit]="submit"
      bit-dialog
      title="Default policy"
      [subtitle]="data.definition.name | i18n"
    >
      <ng-container bitDialogContent>
        @if (data.definition.showDescription) {
          <p bitTypography="body1">{{ data.definition.description | i18n }}</p>
        }
        @if (data.followers.length > 0) {
          <bit-callout type="info" [title]="null" data-testid="default-policy-followers">
            <p class="tw-mb-2">
              Saving changes this policy in the clients that follow the default and are checked
              here. Unchecked clients keep what they have now, as their own setting. Clients with
              their own setting keep it.
            </p>
            <div [formGroup]="reach">
              @for (client of data.followers; track client.id) {
                <bit-form-control [disableMargin]="$last">
                  <input type="checkbox" bitCheckbox [formControlName]="client.id" />
                  <bit-label>{{ client.name }}</bit-label>
                </bit-form-control>
              }
            </div>
          </bit-callout>
        } @else {
          <bit-callout type="info" [title]="null">
            No client follows this default now. Clients you add later start with it.
          </bit-callout>
        }
        <ng-template #policyForm></ng-template>
      </ng-container>
      <ng-container bitDialogFooter>
        <button bitButton bitFormButton buttonType="primary" type="submit">Save default</button>
        <button bitButton buttonType="secondary" type="button" bitDialogClose>Cancel</button>
      </ng-container>
    </form>
  `,
})
export class KeykeeperDefaultPolicyDialogComponent implements AfterViewInit {
  private readonly policyForm = viewChild("policyForm", { read: ViewContainerRef });
  private readonly policyComponent = signal<BasePolicyEditComponent | undefined>(undefined);
  protected readonly formGroup = new FormGroup({});
  /** A checkbox per client that follows the default: checked ones change. */
  protected readonly reach = new FormGroup<Record<string, FormControl<boolean | null>>>(
    Object.fromEntries(
      this.data.followers.map((c) => [c.id, new FormControl<boolean | null>(true)]),
    ),
  );

  constructor(
    @Inject(DIALOG_DATA) protected readonly data: DefaultPolicyDialogData,
    private readonly dialogRef: DialogRef<DefaultPolicyDialogResult>,
    private readonly accountService: AccountService,
    private readonly keyService: KeyService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngAfterViewInit() {
    const ref = this.policyForm()!.createComponent(this.data.definition.component);
    ref.setInput("policy", this.data.definition);
    ref.setInput(
      "policyResponse",
      new PolicyResponse({
        OrganizationId: this.data.organizationId,
        Type: this.data.policy.type,
        Enabled: this.data.policy.enabled,
        Data: this.data.policy.data,
        CanToggleState: true,
      }),
    );
    if (this.data.organizationId != null) {
      ref.setInput("organizationId", this.data.organizationId);
    }
    this.policyComponent.set(ref.instance);
    this.cdr.detectChanges();
  }

  protected readonly submit = async () => {
    const component = this.policyComponent();
    if (component == null) {
      return;
    }
    if (component.data?.invalid) {
      component.data.markAllAsTouched();
      return;
    }
    const request = await component.buildRequest(await this.orgKey());
    const keep = Object.entries(this.reach.value)
      .filter(([, on]) => !on)
      .map(([id]) => id);
    await this.dialogRef.close({
      enabled: request.policy.enabled,
      data: request.policy.data,
      keep,
    });
  };

  private async orgKey() {
    const orgId = this.data.organizationId as OrganizationId | undefined;
    if (orgId == null) {
      return undefined;
    }
    return firstValueFrom(
      this.accountService.activeAccount$.pipe(
        getUserId,
        switchMap((userId) => this.keyService.orgKeys$(userId)),
        map((keys) => keys?.[orgId] ?? undefined),
      ),
    );
  }

  static open(dialogService: DialogService, data: DefaultPolicyDialogData) {
    return dialogService.open<DefaultPolicyDialogResult, DefaultPolicyDialogData>(
      KeykeeperDefaultPolicyDialogComponent,
      { data },
    );
  }
}
