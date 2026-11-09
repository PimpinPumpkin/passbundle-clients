import { ChangeDetectionStrategy, Component, computed, input, signal } from "@angular/core";

import {
  INSTALL_COMMAND_REFUSED,
  InstallCommandParts,
  installOptionsFor,
  InstallPlatform,
  installSteps,
  MAC_PROFILE_SCRIPT,
} from "@bitwarden/admin-console/common";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

/** The command's parts, with the organization's fingerprint phrase from the same key. */
export type ShownInstallParts = InstallCommandParts & { phrase?: string[] | null };

/**
 * Keykeeper: an install command to copy, for Windows, Mac, or Linux, each
 * carrying the same server, token, join secret, and key fingerprint, checked
 * and quoted for the shell that runs it (install-command.ts). A Mac takes
 * managed settings only from a profile an MDM installs, so its command makes
 * that profile, and a second one installs the app. Used by the MSP console
 * for each client and by a company's own Settings page. See DESIGN.md,
 * "Onboarding through the RMM".
 */
@Component({
  selector: "app-keykeeper-install-command",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <div class="tw-mb-3">
      <bit-toggle-group
        [selected]="platform()"
        (selectedChange)="platform.set($event)"
        label="The computers it's for"
        [attr.data-testid]="testId('platform')"
      >
        <bit-toggle value="windows">Windows</bit-toggle>
        <bit-toggle value="macos">Mac</bit-toggle>
        <bit-toggle value="linux">Linux</bit-toggle>
      </bit-toggle-group>
    </div>
    @switch (platform()) {
      @case ("windows") {
        <p bitTypography="body2">
          Run this on {{ whose() }} Windows computers as an administrator, from your RMM, Intune, or
          group policy, in the folder with our install script, {{ scripts.windows }}. It turns off
          the browsers' own password saving, and installs the extension once it's in the Chrome and
          Edge stores, with this server filled in. Anyone who then signs in joins {{ joins() }}.
        </p>
      }
      @case ("macos") {
        <p bitTypography="body2">
          A Mac takes two steps: macOS takes managed settings only from a configuration profile that
          an MDM installs. First, run this on your own Mac, in the folder with our
          {{ profileScript }} script, and upload the {{ scripts.macProfile }} it makes to your MDM
          (such as Intune, Jamf, or Kandji) for {{ whose() }} Macs. The profile turns off the
          browsers' own password saving, and installs the extension once it's in the Chrome and Edge
          stores, with this server filled in. Anyone who then signs in joins {{ joins() }}.
        </p>
      }
      @case ("linux") {
        <p bitTypography="body2">
          Run this on {{ whose() }} Linux computers as root, from your RMM, in the folder with our
          install script, {{ scripts.unix }}. It turns off Chrome's and Edge's own password saving,
          and installs the extension once it's in their stores, with this server filled in. Anyone
          who then signs in joins {{ joins() }}. With the app's folder from our package next to the
          script, it installs the app too.
        </p>
      }
    }
    @if (autofillOff()) {
      <p bitTypography="body2" [attr.data-testid]="testId('autofill-off')">
        It also turns off the browsers' own card and address autofill, as this organization's
        setting says, in every profile on the computer.
      </p>
    }
    @if (steps(); as s) {
      <pre
        class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
        [attr.data-testid]="testId('command')"
        [attr.data-platform]="platform()"
        >{{ s.command }}</pre>
      <div class="tw-mb-3 tw-flex tw-gap-2">
        <button bitButton buttonType="secondary" type="button" (click)="copy(s.command, 'command')">
          {{ platform() === "macos" ? "Copy profile command" : "Copy command" }}
        </button>
      </div>
      @if (s.app; as app) {
        <p bitTypography="body2">
          Then, to install the app and its desktop agent too, run our install script,
          {{ scripts.unix }}, as root from your RMM or MDM, with the app from our package next to
          it. It carries nothing secret: the profile has the rest.
        </p>
        <pre
          class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
          [attr.data-testid]="testId('app-command')"
          >{{ app }}</pre>
        <div class="tw-mb-3 tw-flex tw-gap-2">
          <button bitButton buttonType="secondary" type="button" (click)="copy(app, 'app')">
            Copy app command
          </button>
        </div>
      }
    } @else {
      <p
        bitTypography="body2"
        class="tw-text-danger"
        [attr.data-testid]="testId('command-refused')"
      >
        {{ refused }}
      </p>
    }
    @if (parts()?.phrase; as phrase) {
      <p bitTypography="helper" [attr.data-testid]="testId('phrase')">
        People who join see {{ joins() }}'s fingerprint phrase, to check with you:
        <span class="tw-font-mono">{{ phrase.join("-") }}</span>
      </p>
    }
  `,
})
export class KeykeeperInstallCommandComponent {
  /** The command's enrollment token. */
  readonly token = input.required<string>();
  /** The join secret and key fingerprint; null for a command made before them. */
  readonly parts = input<ShownInstallParts | null>(null);
  /** The server the command names: this web vault's. */
  readonly serverUrl = input.required<string>();
  /** Whose computers, such as "Acme Dental's" or "your organization's". */
  readonly whose = input.required<string>();
  /** What people join, such as "Acme Dental" or "the organization". */
  readonly joins = input.required<string>();
  /** The start of each test id, such as "msp-install". */
  readonly testIdPrefix = input.required<string>();
  /** The organization's browser autofill setting, from the server; off adds the scripts' options. */
  readonly browserAutofill = input<string | undefined>(undefined);

  protected readonly platform = signal<InstallPlatform>("windows");
  protected readonly refused = INSTALL_COMMAND_REFUSED;
  protected readonly profileScript = MAC_PROFILE_SCRIPT;
  /** The scripts' names, which carry the product's name, from the brand. */
  protected readonly scripts = {
    windows: this.i18nService.t("keykeeperInstallScript"),
    unix: this.i18nService.t("keykeeperInstallScriptMacLinux"),
    macProfile: this.i18nService.t("keykeeperMacProfile"),
  };

  protected readonly steps = computed(() =>
    installSteps(
      this.platform(),
      this.scripts,
      this.serverUrl(),
      this.token(),
      this.parts(),
      installOptionsFor(this.browserAutofill()),
    ),
  );
  /** Whether the command turns off the browsers' card and address autofill. */
  protected readonly autofillOff = computed(
    () => installOptionsFor(this.browserAutofill()).browserAutofillOff === true,
  );

  constructor(
    private readonly i18nService: I18nService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly toastService: ToastService,
  ) {}

  protected testId(name: string): string {
    return `${this.testIdPrefix()}-${name}`;
  }

  protected copy(text: string, which: "command" | "app") {
    this.platformUtilsService.copyToClipboard(text);
    this.toastService.showToast({
      variant: "success",
      message:
        which === "app"
          ? "Copied the app command"
          : this.platform() === "macos"
            ? "Copied the profile command"
            : "Copied the install command",
    });
  }
}
