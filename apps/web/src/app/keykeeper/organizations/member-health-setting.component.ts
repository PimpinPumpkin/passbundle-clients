import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";

import { OrgMemberHealthSetting } from "@bitwarden/admin-console/common";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: "Members' own passwords" on an organization's Settings page, for
 * its owners and admins (and its MSP's admins); the server answers no one
 * else, and the card stays hidden. On, each member's apps send how many of
 * their own passwords are weak, reused, or exposed, never which ones, and
 * the organization's Reports shows the numbers; members are told by name on
 * their Health page. Off, the numbers no other organization sees are
 * deleted. See DESIGN.md, "Members' own passwords".
 */
@Component({
  selector: "app-keykeeper-member-health-setting",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (setting(); as s) {
      <section data-testid="member-health-setting">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Members' own passwords</h1>
        <p bitTypography="body1">
          Each member's apps count the logins in their own items and send only how many are weak,
          reused, or exposed, never which ones. Owners and admins see the numbers in Reports.
          Members are told on their Health page that this organization's admins see them.
        </p>
        @if (s.msp && s.requiredByMsp) {
          <p bitTypography="body2" data-testid="member-health-setting-msp">
            <span bitBadge variant="primary" startIcon="bwi-lock" [truncate]="false"
              >Required by {{ s.msp.name }}</span
            >
            {{ s.msp.name }} requires this for every client, so only {{ s.msp.name }}'s console
            changes it.
          </p>
        } @else if (s.msp) {
          <p bitTypography="body2" data-testid="member-health-setting-msp">
            {{ s.msp.name }} sets this by default. Changing it here makes it this organization's own
            setting.
          </p>
        }
        <form [formGroup]="form" [bitSubmit]="save" aria-label="Members' own passwords">
          <bit-form-control>
            <input type="checkbox" bitCheckbox formControlName="enabled" />
            <bit-label
              >See how many of members' own passwords are weak, reused, or exposed</bit-label
            >
            <bit-hint>
              Off, members' apps stop sending the numbers, and the numbers already sent are deleted
              unless another organization of theirs sees them.
            </bit-hint>
          </bit-form-control>
          @if (!s.requiredByMsp) {
            <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
          }
        </form>
      </section>
    }
  `,
})
export class KeykeeperMemberHealthSettingComponent {
  readonly organizationId = input.required<string>();

  protected readonly setting = signal<OrgMemberHealthSetting | null>(null);
  protected readonly form = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
  });

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.organizationId();
      // Not an owner or admin: the server says not found, and the card stays hidden.
      this.api.getOrgMemberHealth(id).then(
        (s) => this.show(s),
        () => this.setting.set(null),
      );
    });
  }

  private show(setting: OrgMemberHealthSetting) {
    this.setting.set(setting);
    this.form.controls.enabled.setValue(setting.enabled);
    // The MSP requires it for every client, so it's not this page's to change.
    if (setting.requiredByMsp) {
      this.form.controls.enabled.disable();
    } else {
      this.form.controls.enabled.enable();
    }
  }

  protected readonly save = async () => {
    const current = this.setting();
    const enabled = this.form.controls.enabled.value;
    if (current?.enabled && !enabled) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: "Turn off Members' own passwords?",
        content:
          "Owners and admins stop seeing the numbers, and the numbers members' apps already sent are deleted unless another organization of theirs sees them. The change goes in the event log.",
        acceptButtonText: "Turn it off",
        type: "warning",
      });
      if (!confirmed) {
        this.show(current);
        return;
      }
    }
    try {
      const saved = await this.api.setOrgMemberHealth(this.organizationId(), enabled);
      this.show(saved);
      this.toastService.showToast({
        variant: "success",
        message: saved.enabled ? "Members' own passwords is on" : "Members' own passwords is off",
      });
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    }
  };
}
