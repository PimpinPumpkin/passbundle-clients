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
import { toSignal } from "@angular/core/rxjs-interop";
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
import { allNames } from "./msp-policies";

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
  /** Whether it's required for every client now (DESIGN.md, "Required for every client"). */
  required: boolean;
  /** The clients with their own setting, which requiring it replaces. */
  own: { id: string; name: string }[];
  /** While it's required: the clients that had their own setting before. */
  hadOwn: { id: string; name: string }[];
  /** The policies this one needs on in each client, by name, and whether their default is on. */
  needs: { name: string; on: boolean }[];
};

/**
 * The default as saved: on or off, with its options, the clients that follow
 * it but stay as they are this time, and whether it's required for every
 * client.
 */
export type DefaultPolicyDialogResult = {
  enabled: boolean;
  data: any;
  keep: string[];
  required: boolean;
};

/**
 * Keykeeper: edits one of an MSP's default policies with upstream's own form
 * for that policy, so its options, wording, and checks match a client's admin
 * console, and chooses how clients get it: as a default they follow unless one
 * sets its own, or required for every client, locked in their admin consoles.
 * Saving returns the policy; the caller sends it to the MSP.
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
        <div [formGroup]="choice" class="tw-mb-4">
          <bit-radio-group formControlName="kind" [block]="true">
            <bit-label>How clients get it</bit-label>
            <bit-radio-button value="default">
              <bit-label>Default</bit-label>
              <bit-hint>Clients follow it unless one sets its own.</bit-hint>
            </bit-radio-button>
            <bit-radio-button value="required">
              <bit-label>Required for every client</bit-label>
              <bit-hint>
                Every client gets it, including those with their own setting, and nobody can change
                it in a client's admin console until it's no longer required.
              </bit-hint>
            </bit-radio-button>
          </bit-radio-group>
        </div>
        @if (requiredChosen()) {
          <bit-callout type="warning" [title]="null" data-testid="default-policy-required">
            <p class="tw-mb-0">
              Saving changes this policy in every client whose setting differs.
              @if (!data.required && data.own.length > 0) {
                That includes the clients with their own setting: {{ ownNames }}.
              }
              Before saving, you'll see which clients change.
            </p>
            @for (n of data.needs; track n.name) {
              <p class="tw-mb-0 tw-mt-2">
                It needs {{ n.name }}, which then stays on in every client.
                @if (!n.on) {
                  Turn on the {{ n.name }} default first.
                }
              </p>
            }
          </bit-callout>
        } @else if (data.required) {
          <bit-callout type="info" [title]="null" data-testid="default-policy-had-own">
            @if (data.hadOwn.length > 0) {
              <p class="tw-mb-2">
                These clients had their own setting before you required it. They keep the required
                setting; change it in their admin console if one should go back.
              </p>
              <ul class="tw-mb-0" aria-label="Clients that had their own setting">
                @for (client of data.hadOwn; track client.id) {
                  <li>{{ client.name }}</li>
                }
              </ul>
            } @else {
              <p class="tw-mb-0">
                No client had its own setting before you required it. Every client keeps the
                required setting and follows the default from now on.
              </p>
            }
          </bit-callout>
        } @else if (data.followers.length > 0) {
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
        @if (error(); as message) {
          <p class="tw-mt-2 tw-text-danger" role="alert" data-testid="default-policy-error">
            {{ message }}
          </p>
        }
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
  /** A default clients follow, or required for every client. */
  protected readonly choice = new FormGroup({
    kind: new FormControl<"default" | "required">(this.data.required ? "required" : "default", {
      nonNullable: true,
    }),
  });
  protected readonly requiredChosen = toSignal(
    this.choice.controls.kind.valueChanges.pipe(map((kind) => kind === "required")),
    { initialValue: this.data.required },
  );
  protected readonly ownNames = allNames(this.data.own);
  protected readonly error = signal<string | null>(null);
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
    const required = this.choice.controls.kind.value === "required";
    if (required && !request.policy.enabled) {
      this.error.set(
        "Only a policy that's on can be required for every client. Turn it on, or choose Default.",
      );
      return;
    }
    const keep = required
      ? []
      : Object.entries(this.reach.value)
          .filter(([, on]) => !on)
          .map(([id]) => id);
    await this.dialogRef.close({
      enabled: request.policy.enabled,
      data: request.policy.data,
      keep,
      required,
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
