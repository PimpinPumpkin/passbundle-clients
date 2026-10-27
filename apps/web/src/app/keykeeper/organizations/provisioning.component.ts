import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { ProvisioningView } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";
import { KeykeeperMspWorkService } from "../msp/msp-work.service";

/**
 * Keykeeper: an organization's Provisioning page, under Settings, for its
 * owners and admins and its MSP's admins (the server answers no one else).
 * Microsoft Entra ID's provisioning service uses the SCIM URL and the token
 * made here to invite, turn off, turn on, and remove regular members, and to
 * keep the groups it makes in step. The token is shown once. People the
 * directory invited wait until someone here lets them in, which seals their
 * invitations in this browser. See DESIGN.md, "Provisioning from Entra ID".
 */
@Component({
  selector: "app-keykeeper-provisioning",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule],
  template: `
    <app-header title="Provisioning"></app-header>
    <bit-container>
      @if (refused()) {
        <p bitTypography="body1" data-testid="provisioning-refused">
          This organization's owners and admins, and its IT provider's admins, set up provisioning.
        </p>
      } @else if (view(); as v) {
        <section data-testid="provisioning" class="tw-max-w-3xl">
          <p bitTypography="body1">
            Connect Microsoft Entra ID, and people you add to this organization's app in Microsoft
            365 are invited here as members; people you turn off, unassign, or delete there lose
            access here. Entra's groups can come along too, with their members: you choose which
            shared folders each group opens, here. Provisioning never changes owners, admins, or
            custom roles, and never sees what's in anyone's vault.
          </p>

          <h2 bitTypography="h3" class="tw-mt-8">Tenant URL</h2>
          <div class="tw-flex tw-items-center tw-gap-2">
            <code
              class="tw-break-all tw-rounded tw-bg-background-alt tw-px-3 tw-py-2 tw-text-sm"
              data-testid="provisioning-url"
              >{{ v.scimUrl }}</code
            >
            <button bitButton buttonType="secondary" type="button" (click)="copy(v.scimUrl, 'URL')">
              Copy
            </button>
          </div>

          <h2 bitTypography="h3" class="tw-mt-8">Secret token</h2>
          @if (madeToken(); as token) {
            <bit-callout
              type="success"
              title="Copy the token now"
              data-testid="provisioning-token-made"
            >
              <p class="tw-mb-2">
                This is the only time it's shown. Paste it into Entra as the Secret Token. If you
                lose it, replace it here and paste the new one.
              </p>
              <pre
                class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
                data-testid="provisioning-token"
                >{{ token }}</pre>
              <div class="tw-flex tw-gap-2">
                <button bitButton buttonType="primary" type="button" (click)="copy(token, 'token')">
                  Copy token
                </button>
                <button
                  bitButton
                  buttonType="secondary"
                  type="button"
                  (click)="madeToken.set(null)"
                >
                  Done
                </button>
              </div>
            </bit-callout>
          }
          @if (v.token; as t) {
            <p bitTypography="body2" data-testid="provisioning-token-info">
              Made {{ t.createdAt | date: "medium" }} by {{ t.createdBy }}.
              @if (t.creatorLostAccess) {
                It stopped working: {{ t.createdBy }} no longer manages this organization. Replace
                the token and paste the new one into Entra.
              }
              @if (t.lastUsedAt) {
                Last sync {{ t.lastUsedAt | date: "medium" }} from {{ t.lastUsedIp }}.
              } @else {
                Not used yet.
              }
            </p>
            <p bitTypography="helper">
              {{ peopleLine(v) }}
            </p>
            <div class="tw-flex tw-gap-2">
              <button bitButton buttonType="secondary" type="button" [bitAction]="replace">
                Replace token
              </button>
              <button bitButton buttonType="danger" type="button" [bitAction]="revoke">
                Revoke
              </button>
            </div>
          } @else {
            <p bitTypography="body2">No token yet: provisioning is off.</p>
            <button bitButton buttonType="primary" type="button" [bitAction]="create">
              Create token
            </button>
          }

          @if (v.waiting.length > 0) {
            <h2 bitTypography="h3" class="tw-mt-8">Waiting to be let in</h2>
            <p bitTypography="body2">
              Entra invited these people. Joining means getting this organization's key from an
              owner's or admin's browser, which does it only for people one of you chose, so check
              these are people you know and let them in. They get in within a few minutes of
              joining, or right away if they already have. People who join with your install command
              at your email domains don't wait here.
            </p>
            <ul class="tw-mb-3 tw-list-none tw-p-0" data-testid="provisioning-waiting">
              @for (p of v.waiting; track p.memberId) {
                <li class="tw-py-1">
                  <label class="tw-flex tw-items-center tw-gap-2">
                    <input
                      type="checkbox"
                      bitCheckbox
                      [checked]="chosen().has(p.memberId)"
                      (change)="toggle(p.memberId)"
                      [attr.aria-label]="'Let in ' + p.email"
                    />
                    <span>{{ p.email }}</span>
                    <span class="tw-text-sm tw-text-muted">
                      {{ p.joined ? "has joined" : "hasn't joined yet" }}
                    </span>
                  </label>
                </li>
              }
            </ul>
            <button
              bitButton
              buttonType="primary"
              type="button"
              [disabled]="chosen().size === 0"
              [bitAction]="letIn"
            >
              Let them in
            </button>
          }

          @if (v.turnedOff.length > 0) {
            <h2 bitTypography="h3" class="tw-mt-8">Turned off in Entra</h2>
            <p bitTypography="body2">
              Entra turned these people off or deleted them, but provisioning doesn't change owners,
              admins, custom roles, or your IT provider's staff. If they've left, remove them on the
              Members page.
            </p>
            <ul class="tw-mb-3" data-testid="provisioning-turned-off">
              @for (p of v.turnedOff; track p.memberId) {
                <li>{{ p.email }} ({{ p.role }}), {{ p.at | date: "mediumDate" }}</li>
              }
            </ul>
            <a bitLink [routerLink]="['/organizations', organizationId(), 'members']">Members</a>
          }

          <h2 bitTypography="h3" class="tw-mt-8">Setting up Entra</h2>
          <ol class="tw-list-decimal tw-pl-6" data-testid="provisioning-steps">
            <li>
              In the Microsoft Entra admin center, go to Enterprise applications, then New
              application, then Create your own application. Name it PassBundle, and choose to
              integrate an application you don't find in the gallery.
            </li>
            <li>
              In the new application, open Provisioning and choose Automatic (or New configuration).
            </li>
            <li>
              Paste the Tenant URL and the Secret Token from this page. To have Entra send its more
              standard requests, add ?aadOptscim062020 to the end of the URL; either way works.
            </li>
            <li>Test the connection, then save.</li>
            <li>
              Under Users and groups, assign the people or groups who should be in this
              organization. Each needs an email address: Entra sends their mail, or their user
              principal name when it's an email address.
            </li>
            <li>
              Start provisioning. The first sync can take a while; after that Entra syncs about
              every 40 minutes, and Provision on demand tries one person right away.
            </li>
          </ol>
          @if (!v.groupsEnabled) {
            <p bitTypography="helper">
              Groups are turned off on this server, so turn off group provisioning in Entra's
              mappings.
            </p>
          }
        </section>
      }
    </bit-container>
  `,
})
export class KeykeeperProvisioningComponent implements OnInit {
  protected readonly organizationId = signal("");
  /** Null while loading. */
  protected readonly view = signal<ProvisioningView | null>(null);
  protected readonly refused = signal(false);
  protected readonly madeToken = signal<string | null>(null);
  /** People on the waiting list someone here unticked. */
  private readonly unticked = signal<Set<string>>(new Set());
  protected readonly chosen = computed(
    () =>
      new Set(
        (this.view()?.waiting ?? [])
          .map((p) => p.memberId)
          .filter((id) => !this.unticked().has(id)),
      ),
  );

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: KeykeeperMspApiService,
    private readonly mspWork: KeykeeperMspWorkService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {}

  async ngOnInit() {
    const params = await firstValueFrom(this.route.params);
    this.organizationId.set(params.organizationId);
    await this.load();
  }

  private async load() {
    try {
      this.view.set(await this.api.getProvisioning(this.organizationId()));
    } catch {
      this.refused.set(true);
    }
  }

  protected peopleLine(v: ProvisioningView): string {
    const people = v.people === 1 ? "1 person" : `${v.people} people`;
    const groups = v.groups === 1 ? "1 group" : `${v.groups} groups`;
    return `${people} and ${groups} here come from Microsoft Entra ID.`;
  }

  protected toggle(memberId: string) {
    const next = new Set(this.unticked());
    if (next.has(memberId)) {
      next.delete(memberId);
    } else {
      next.add(memberId);
    }
    this.unticked.set(next);
  }

  protected copy(value: string, what: string) {
    this.platformUtilsService.copyToClipboard(value);
    this.toastService.showToast({ variant: "success", message: `Copied the ${what}` });
  }

  private show(view: ProvisioningView) {
    if (view.newToken) {
      this.madeToken.set(view.newToken);
    }
    // The token itself is never kept in the page's state beyond the callout.
    this.view.set({ ...view, newToken: undefined });
  }

  protected readonly create = async () => {
    await this.attempt(async () =>
      this.show(await this.api.makeProvisioningToken(this.organizationId())),
    );
  };

  protected readonly replace = async () => {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: "Replace the provisioning token?",
      content:
        "The current token stops working right away. Entra's provisioning fails until you paste the new one into it.",
      acceptButtonText: "Replace token",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    await this.attempt(async () => {
      this.show(await this.api.makeProvisioningToken(this.organizationId()));
      this.toastService.showToast({
        variant: "success",
        message: "Replaced the provisioning token",
      });
    });
  };

  protected readonly revoke = async () => {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: "Revoke the provisioning token?",
      content:
        "Entra stops adding and removing people here until you make a new token. Nobody already here is removed.",
      acceptButtonText: "Revoke",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    await this.attempt(async () => {
      this.madeToken.set(null);
      this.show(await this.api.revokeProvisioningToken(this.organizationId()));
      this.toastService.showToast({
        variant: "success",
        message: "Revoked the provisioning token",
      });
    });
  };

  protected readonly letIn = async () => {
    const v = this.view();
    if (v == null) {
      return;
    }
    const emails = v.waiting.filter((p) => this.chosen().has(p.memberId)).map((p) => p.email);
    if (emails.length === 0) {
      return;
    }
    await this.attempt(async () => {
      this.show(await this.api.letInProvisioned(this.organizationId(), emails));
      this.unticked.set(new Set());
      this.toastService.showToast({
        variant: "success",
        message:
          emails.length === 1 ? `Letting in ${emails[0]}` : `Letting in ${emails.length} people`,
      });
      // Those who already joined get in now, from this browser.
      void this.mspWork.run();
    });
  };

  private async attempt(work: () => Promise<void>) {
    try {
      await work();
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
