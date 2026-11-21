import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { ButtonModule, LinkModule, TypographyModule } from "@bitwarden/components";

import { KeykeeperFamilyLinkService } from "./family-link.service";
import { qrCodeImage } from "./qr-code";

/** What the sheet says, with nothing on it that unlocks a vault. */
export type FamilySheet = {
  familyName: string;
  webVault: string;
  download: string;
  /** While the link works: its QR code, when it ends, and whether it lets people in on its own. */
  link: { qr: string | null; endsAt: Date; automatic: boolean } | null;
};

/**
 * Keykeeper: a sheet to print for the family (DESIGN.md, "A family's invite
 * link"): the family's name, the web vault's address, where to get the apps,
 * and, while the link works, its QR code. Never a master password, a key, or
 * anything else that unlocks a vault, and no line to write a master password
 * on. For the family's owners and admins, who are the only ones the server
 * gives the link to.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, LinkModule, RouterLink, TypographyModule],
  styles: [
    `
      @media print {
        :host {
          color: #000;
          background: #fff;
        }
      }
    `,
  ],
  template: `
    <main class="tw-mx-auto tw-max-w-2xl tw-p-8 print:tw-p-0" data-testid="family-sheet">
      <div class="tw-mb-8 tw-flex tw-gap-2 print:tw-hidden">
        <button bitButton buttonType="primary" type="button" (click)="print()">Print</button>
        <a bitButton buttonType="secondary" [routerLink]="back()">Back</a>
      </div>
      @if (sheet(); as s) {
        <h1 bitTypography="h1">{{ s.familyName }}: how to get in</h1>
        <ol class="tw-mt-6 tw-space-y-4 tw-pl-6">
          <li bitTypography="body1">
            On a computer, open
            <span class="tw-font-semibold" data-testid="family-sheet-vault">{{ s.webVault }}</span>
            in a browser. On a phone or tablet, get the app:
            <span class="tw-font-semibold" data-testid="family-sheet-download">{{
              s.download
            }}</span>
          </li>
          <li bitTypography="body1">
            Sign in, or create an account with any email address. Choose a master password only you
            know: nobody in the family can see it or reset it for you.
          </li>
          <li bitTypography="body1">
            @if (s.link; as link) {
              Join {{ s.familyName }}: scan this code with your phone's camera, and follow it.
              @if (link.qr; as qr) {
                <img
                  [src]="qr"
                  width="200"
                  height="200"
                  alt="QR code for the invite link"
                  class="tw-my-3 tw-block"
                  data-testid="family-sheet-qr"
                />
              }
              <span data-testid="family-sheet-ends">
                @if (link.automatic) {
                  Anyone who scans it gets in until {{ ends(link.endsAt) }}, so keep this sheet at
                  home.
                } @else {
                  Anyone who scans it can ask to join until {{ ends(link.endsAt) }}, so keep this
                  sheet at home.
                }
              </span>
            } @else {
              <span data-testid="family-sheet-no-link"
                >Ask whoever runs {{ s.familyName }} for an invite link.</span
              >
            }
          </li>
        </ol>
        <p bitTypography="body2" class="tw-mt-8">Don't write your master password on this sheet.</p>
      } @else if (refused()) {
        <p bitTypography="body1" data-testid="family-sheet-refused">
          Only a family's owners and admins can print its sheet.
        </p>
      }
    </main>
  `,
})
export class KeykeeperFamilySheetComponent implements OnInit {
  protected readonly sheet = signal<FamilySheet | null>(null);
  protected readonly refused = signal(false);

  private readonly route = inject(ActivatedRoute);
  private readonly accountService = inject(AccountService);
  private readonly organizationService = inject(OrganizationService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly i18nService = inject(I18nService);
  private readonly familyLinks = inject(KeykeeperFamilyLinkService);
  private readonly organizationId = signal("");

  protected back(): string[] {
    return ["/organizations", this.organizationId(), "settings", "joining"];
  }

  protected ends(date: Date): string {
    return date.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  }

  protected print() {
    window.print();
  }

  async ngOnInit() {
    const organizationId = this.route.snapshot.paramMap.get("organizationId") ?? "";
    this.organizationId.set(organizationId);
    const view = await this.familyLinks.get(organizationId);
    if (view == null) {
      this.refused.set(true);
      return;
    }
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const organizations = await firstValueFrom(this.organizationService.organizations$(userId));
    const family = organizations.find((o) => o.id === organizationId);
    const environment = await firstValueFrom(this.environmentService.environment$);
    const shown = await this.familyLinks.shown(organizationId, view).catch((): null => null);
    this.sheet.set({
      familyName: family?.name ?? "",
      webVault: environment.getWebVaultUrl(),
      download: this.i18nService.t("keykeeperDownloadPage"),
      link:
        shown?.settings.expiresAt == null
          ? null
          : {
              qr: await qrCodeImage(shown.address, 240),
              endsAt: new Date(shown.settings.expiresAt * 1000),
              automatic: shown.settings.automatic === true,
            },
    });
  }
}
