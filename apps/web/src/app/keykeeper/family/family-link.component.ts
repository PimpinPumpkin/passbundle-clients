import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import {
  CollectionAdminService,
  FAMILY_LINK_AUTOMATIC,
  FAMILY_LINK_DAYS,
  FAMILY_LINK_DEFAULT_DAYS,
} from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { FamilyLinkView, KeykeeperFamilyLinkService, ShownFamilyLink } from "./family-link.service";
import { qrCodeImage } from "./qr-code";

type Approval = "oneTap" | "automatic";
type Folder = { id: string; name: string };

/** How a person who joined with the link got in, in a few words. */
export function joinedHow(join: { automatic: boolean; status: number }): string {
  if (join.status < 0) {
    return "Access turned off";
  }
  if (join.status === 2) {
    return join.automatic ? "Let in automatically" : "In";
  }
  return join.automatic ? "Being let in" : "Waiting for you on the Members page";
}

/**
 * Keykeeper: a family's invite link, on its Joining and security page, for
 * its owners and admins (the server answers no one else, and the card stays
 * hidden, as it does for every organization that isn't a family). The link
 * and its QR code, how long it works, one tap or automatic, a new link, off,
 * the printable sheet, and who joined with it. See DESIGN.md, "A family's
 * invite link".
 */
@Component({
  selector: "app-keykeeper-family-link",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (view(); as v) {
      <section data-testid="family-link">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Invite link</h1>
        <p bitTypography="body1">
          Share a link or its QR code with your family. They sign in or create an account with any
          email address, and join.
        </p>
        @if (shown(); as s) {
          <div class="tw-mb-4 tw-flex tw-flex-wrap tw-items-start tw-gap-6">
            @if (qr(); as image) {
              <img
                [src]="image"
                width="180"
                height="180"
                alt="QR code for the invite link"
                data-testid="family-link-qr"
              />
            }
            <div class="tw-min-w-0 tw-max-w-xl tw-flex-1">
              <bit-form-field>
                <bit-label>Link</bit-label>
                <input
                  bitInput
                  readonly
                  [value]="s.address"
                  data-testid="family-link-address"
                  aria-label="Invite link"
                />
              </bit-form-field>
              <p bitTypography="body2" data-testid="family-link-ends">
                Works until {{ s.settings.expiresAt! * 1000 | date: "medium" }}.
              </p>
              <div class="tw-flex tw-flex-wrap tw-gap-2">
                <button bitButton buttonType="primary" type="button" (click)="copy(s.address)">
                  Copy link
                </button>
                <a
                  bitButton
                  buttonType="secondary"
                  [routerLink]="['/family-sheet', organizationId()]"
                  data-testid="family-link-sheet"
                >
                  Print a sheet for the family
                </a>
              </div>
            </div>
          </div>
        } @else if (v.on && !v.live) {
          <p bitTypography="body1" data-testid="family-link-ended">
            The link ended {{ v.expiresAt | date: "medium" }}. Make a new one to invite more people.
          </p>
        } @else if (v.live) {
          <p bitTypography="body1" data-testid="family-link-unchecked">
            This browser can't show the link: it can't check its settings. Make a new link to show
            one here; the old one stops working.
          </p>
        }

        <form [formGroup]="form" class="tw-max-w-xl" aria-label="Invite link">
          <bit-radio-group formControlName="approval" [block]="true" class="tw-mb-4 tw-block">
            <bit-label>When someone joins with the link</bit-label>
            <bit-radio-button value="oneTap" data-testid="family-link-one-tap">
              <bit-label>An owner or admin lets them in with one tap</bit-label>
              <bit-hint>
                They wait on the Members page with their fingerprint phrase, which you can compare
                with theirs before you confirm them.
              </bit-hint>
            </bit-radio-button>
            <bit-radio-button value="automatic" data-testid="family-link-automatic">
              <bit-label>Automatically</bit-label>
              <bit-hint>
                {{ automaticMeans }} An owner's or admin's web vault or extension lets them in while
                it's open and unlocked, and you're told who joined.
              </bit-hint>
            </bit-radio-button>
          </bit-radio-group>
          @if (shown()) {
            <button
              bitButton
              buttonType="secondary"
              type="button"
              class="tw-mb-6"
              [bitAction]="saveApproval"
              data-testid="family-link-save-approval"
            >
              Save
            </button>
          }
          <div class="tw-flex tw-flex-wrap tw-gap-4">
            <bit-form-field class="tw-w-48">
              <bit-label>A new link works for</bit-label>
              <select bitInput formControlName="days" data-testid="family-link-days">
                @for (d of dayChoices; track d) {
                  <option [ngValue]="d">{{ d === 1 ? "1 day" : d + " days" }}</option>
                }
              </select>
            </bit-form-field>
            @if (folders().length > 1) {
              <bit-form-field class="tw-w-64">
                <bit-label>People who join get</bit-label>
                <select bitInput formControlName="folder" data-testid="family-link-folder">
                  @for (f of folders(); track f.id) {
                    <option [ngValue]="f.id">{{ f.name }}</option>
                  }
                </select>
              </bit-form-field>
            }
          </div>
          <p bitTypography="body2">
            @switch (folders().length) {
              @case (0) {
                This family has no shared folders yet, so people who join see nothing shared until
                you give them a folder.
              }
              @case (1) {
                People who join get {{ folders()[0].name }}, and can edit it.
              }
              @default {
                People who join can edit the folder you pick.
              }
            }
          </p>
          <div class="tw-flex tw-flex-wrap tw-gap-2">
            @if (v.live) {
              <button
                bitButton
                buttonType="secondary"
                type="button"
                [bitAction]="makeNew"
                data-testid="family-link-new"
              >
                Make a new link
              </button>
              <button
                bitButton
                buttonType="danger"
                type="button"
                [bitAction]="turnOff"
                data-testid="family-link-off"
              >
                Turn off
              </button>
            } @else {
              <button
                bitButton
                buttonType="primary"
                type="button"
                [bitAction]="make"
                data-testid="family-link-make"
              >
                Make an invite link
              </button>
            }
          </div>
        </form>

        @if (v.joins.length) {
          <h2 bitTypography="h3" class="tw-mt-8">Joined with the link</h2>
          <ul class="tw-list-none tw-pl-0" data-testid="family-link-joins">
            @for (j of v.joins; track j.memberId) {
              <li class="tw-py-1" [attr.data-email]="j.email">
                <span class="tw-font-semibold">{{ j.name || j.email }}</span>
                @if (j.name) {
                  <span class="tw-text-muted"> ({{ j.email }})</span>
                }
                · {{ j.joinedAt | date: "medium" }} · {{ how(j) }}
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class KeykeeperFamilyLinkComponent {
  readonly organizationId = input.required<string>();

  protected readonly view = signal<FamilyLinkView | null>(null);
  protected readonly shown = signal<ShownFamilyLink | null>(null);
  protected readonly qr = signal<string | null>(null);
  protected readonly folders = signal<Folder[]>([]);
  protected readonly automaticMeans = FAMILY_LINK_AUTOMATIC;
  protected readonly dayChoices = FAMILY_LINK_DAYS;
  protected readonly how = joinedHow;
  protected readonly form = this.formBuilder.nonNullable.group({
    approval: this.formBuilder.nonNullable.control<Approval>("oneTap"),
    days: this.formBuilder.nonNullable.control<number>(FAMILY_LINK_DEFAULT_DAYS),
    folder: this.formBuilder.control<string | null>(null),
  });

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly familyLinks: KeykeeperFamilyLinkService,
    private readonly collectionAdminService: CollectionAdminService,
    private readonly accountService: AccountService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly toastService: ToastService,
    private readonly dialogService: DialogService,
  ) {
    effect(() => {
      void this.load(this.organizationId());
    });
  }

  private async load(organizationId: string) {
    const view = await this.familyLinks.get(organizationId);
    if (view != null) {
      await this.loadFolders(organizationId, view.collectionId);
    }
    await this.show(view);
  }

  /** The family's shared folders, by name, for the folder people who join get. */
  private async loadFolders(organizationId: string, chosen: string | null) {
    try {
      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      const views = await firstValueFrom(
        this.collectionAdminService.collectionAdminViews$(organizationId, userId),
      );
      const folders = views
        .map((c) => ({ id: c.id as string, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.folders.set(folders);
      const keep = folders.find((f) => f.id === chosen) ?? folders[0];
      this.form.controls.folder.setValue(keep?.id ?? null);
    } catch {
      this.folders.set([]);
    }
  }

  private async show(view: FamilyLinkView | null) {
    this.view.set(view);
    if (view == null) {
      this.shown.set(null);
      return;
    }
    this.form.controls.approval.setValue(view.live && view.automatic ? "automatic" : "oneTap");
    const shown = await this.familyLinks.shown(this.organizationId(), view).catch((): null => null);
    this.shown.set(shown);
    this.qr.set(shown == null ? null : await qrCodeImage(shown.address));
  }

  protected copy(address: string) {
    this.platformUtilsService.copyToClipboard(address);
    this.toastService.showToast({ variant: "success", message: "Copied the invite link" });
  }

  private choice() {
    return {
      automatic: this.form.controls.approval.value === "automatic",
      days: this.form.controls.days.value,
      collectionId: this.form.controls.folder.value,
    };
  }

  private async act(what: () => Promise<FamilyLinkView>, done: string) {
    try {
      await this.show(await what());
      this.toastService.showToast({ variant: "success", message: done });
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    }
  }

  protected readonly make = () =>
    this.act(() => this.familyLinks.make(this.organizationId(), this.choice()), "Made the link");

  protected readonly makeNew = async () => {
    const sure = await this.dialogService.openSimpleDialog({
      title: "Make a new link?",
      content: "The link you shared stops working at once. Share the new one instead.",
      acceptButtonText: "Make a new link",
      type: "warning",
    });
    if (sure) {
      await this.act(
        () => this.familyLinks.make(this.organizationId(), this.choice()),
        "Made a new link. The old one no longer works.",
      );
    }
  };

  protected readonly turnOff = async () => {
    const sure = await this.dialogService.openSimpleDialog({
      title: "Turn off the link?",
      content: "Nobody can join with it after this. You can make a new one later.",
      acceptButtonText: "Turn off",
      type: "warning",
    });
    if (sure) {
      await this.act(() => this.familyLinks.turnOff(this.organizationId()), "Turned off the link");
    }
  };

  protected readonly saveApproval = async () => {
    const view = this.view();
    if (view == null) {
      return;
    }
    const automatic = this.form.controls.approval.value === "automatic";
    await this.act(
      () => this.familyLinks.setApproval(this.organizationId(), view, automatic),
      automatic
        ? "People who join with the link get in without you"
        : "You let in each person who joins",
    );
  };
}
