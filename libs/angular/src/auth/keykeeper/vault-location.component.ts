import { AsyncPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormControl } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import { AvailableRegionsService } from "@bitwarden/common/platform/abstractions/available-regions.service";
import {
  Environment,
  EnvironmentService,
  Region,
  RegionConfig,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { DialogService, LinkModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import {
  onlyHttpsValidator,
  selfHostedAddress,
  selfHostedAddressHost,
  SelfHostedEnvConfigDialogComponent,
} from "../self-hosted-env-config-dialog";

import { checkServer, KEYKEEPER_SERVER_CHECK_FETCH, ServerCheck } from "./server-check";

/**
 * Keykeeper: "Where's your vault?" at the top of the extension's sign-in
 * (DESIGN.md, "The look"): PassBundle's service or the person's own server,
 * as a two-way switch, with the server's address right under it when it's
 * their own. It sets the same environment upstream's region menu and
 * self-hosted dialog do, through the dialog's own rules for the address:
 * selfHostedAddress (no scheme means https://) and its https-only validator.
 * Custom addresses for each service (API, identity, and so on) are still the
 * dialog's: when the environment has them, this says so and opens the dialog.
 *
 * Signing in never goes to a server other than the one shown: while My own
 * server is picked and its address is blank or refused, blocksSignIn is true
 * (the sign-in's buttons are off), and commit(), which the sign-in awaits
 * before it goes on, saves a typed address that hasn't been saved yet. The
 * switch and the field always follow the saved environment when it changes.
 *
 * An address is saved only once a server answers there (server-check.ts):
 * otherwise what's wrong shows under the field (nothing answered, it isn't a
 * server, it had a problem), not after the master password as "An
 * unexpected error has occurred."
 */
type ServerProblem = Extract<ServerCheck, { ok: false }>["problem"];

/** Saving a typed address: saved, refused by the server check or the environment, or typed over meanwhile. */
type SaveOutcome = "saved" | "changed" | "invalid" | ServerProblem;

@Component({
  selector: "auth-keykeeper-vault-location",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, I18nPipe, LinkModule],
  template: `
    <div data-part="location">
      <span data-part="label" id="keykeeper-location-label">{{
        "keykeeperWhereIsYourVault" | i18n
      }}</span>
      <div data-part="segments" role="group" aria-labelledby="keykeeper-location-label">
        @for (region of cloudRegions$ | async; track region.key) {
          <button
            type="button"
            data-part="segment"
            [attr.aria-pressed]="!ownServer() && selectedRegion() === region.key"
            (click)="pickCloud(region)"
          >
            {{ (cloudRegions$ | async)?.length === 1 ? ("appName" | i18n) : region.domain }}
          </button>
        }
        <button
          type="button"
          data-part="segment"
          [attr.aria-pressed]="ownServer()"
          (click)="pickOwnServer()"
        >
          {{ "keykeeperMyOwnServer" | i18n }}
        </button>
      </div>
      @if (ownServer() && customAddresses()) {
        <div data-part="server" data-testid="keykeeper-custom-addresses">
          <span data-part="hint">{{ "keykeeperCustomServerAddresses" | i18n }}</span>
          <button type="button" bitLink linkType="primary" (click)="editAddresses()">
            {{ "keykeeperEditServerAddresses" | i18n }}
          </button>
        </div>
      } @else if (ownServer()) {
        <div data-part="server">
          <label data-part="label" for="keykeeper-server-address">{{
            "keykeeperServerAddress" | i18n
          }}</label>
          <input
            #addressInput
            id="keykeeper-server-address"
            type="text"
            data-part="address"
            autocomplete="url"
            autocapitalize="off"
            spellcheck="false"
            inputmode="url"
            placeholder="vault.example.com"
            [value]="address()"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="error() ? 'keykeeper-server-error' : 'keykeeper-server-hint'"
            (input)="typed($any($event.target).value)"
            (change)="saveAddress()"
            (keydown.enter)="saveAddress()"
            data-testid="keykeeper-server-address"
          />
          @if (error(); as message) {
            <span data-part="error" id="keykeeper-server-error" role="alert">{{ message }}</span>
          } @else if (checking()) {
            <span data-part="hint" id="keykeeper-server-hint" aria-live="polite">{{
              "keykeeperServerChecking" | i18n
            }}</span>
          } @else {
            <span data-part="hint" id="keykeeper-server-hint">{{
              "keykeeperServerAddressHint" | i18n
            }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 16px;
    }
    [data-part="location"] {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    [data-part="label"] {
      font-size: 13px;
      font-weight: 600;
      color: var(--pb-label, rgb(var(--color-text-main)));
    }
    [data-part="segments"] {
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      gap: 4px;
      padding: 4px;
      border-radius: 12px;
      background: var(--pb-sunken, rgb(var(--color-secondary-100)));
    }
    [data-part="segment"] {
      height: 36px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: var(--pb-label, rgb(var(--color-text-muted)));
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    [data-part="segment"][aria-pressed="true"] {
      background: var(--pb-raised, rgb(var(--color-background)));
      color: var(--pb-text, rgb(var(--color-text-main)));
      box-shadow: var(
        --pb-segment-shadow,
        0 1px 3px rgb(16 32 27 / 0.12),
        0 1px 1px rgb(16 32 27 / 0.06)
      );
    }
    [data-part="segment"]:focus-visible {
      outline: 2px solid var(--pb-focus, rgb(var(--color-primary-600)));
      outline-offset: 1px;
    }
    [data-part="server"] {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-top: 4px;
    }
    [data-part="address"] {
      height: 44px;
      box-sizing: border-box;
      padding: 0 14px;
      border: 1px solid var(--pb-field-border, rgb(var(--color-secondary-500)));
      border-radius: 10px;
      background: var(--pb-field, rgb(var(--color-background)));
      color: var(--pb-text, rgb(var(--color-text-main)));
      font: inherit;
      font-size: 15px;
      box-shadow: var(--pb-field-shadow, none);
    }
    [data-part="address"]::placeholder {
      color: var(--pb-placeholder, rgb(var(--color-text-muted)));
    }
    [data-part="address"]:focus-visible {
      outline: none;
      border-color: var(--pb-focus, rgb(var(--color-primary-600)));
      box-shadow: 0 0 0 1px var(--pb-focus, rgb(var(--color-primary-600)));
    }
    [data-part="address"][aria-invalid="true"] {
      border-color: var(--color-fg-danger, rgb(var(--color-danger-600)));
    }
    [data-part="hint"] {
      font-size: 12px;
      color: var(--pb-muted, rgb(var(--color-text-muted)));
    }
    [data-part="error"] {
      font-size: 12px;
      color: var(--color-fg-danger, rgb(var(--color-danger-600)));
    }
  `,
})
export class KeykeeperVaultLocationComponent {
  private readonly environmentService = inject(EnvironmentService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fetchServer = inject(KEYKEEPER_SERVER_CHECK_FETCH);

  private readonly addressInput = viewChild<ElementRef<HTMLInputElement>>("addressInput");

  protected readonly cloudRegions$ = inject(AvailableRegionsService).availableRegions$;

  /** "My own server" is picked: shown as soon as it's clicked, saved once there's an address. */
  protected readonly ownServer = signal(false);
  protected readonly selectedRegion = signal<Region | null>(null);
  /** The address in the field: the saved one as the URL parser reads it, or what's typed. */
  protected readonly address = signal("");
  /** The saved self-hosted server's address, or "" when the environment isn't self-hosted. */
  private readonly savedAddress = signal("");
  /** The saved environment has its own address for each service, from the dialog or a policy. */
  protected readonly customAddresses = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A server is being asked whether it's there, before its address is saved. */
  protected readonly checking = signal(false);
  /** Checking and saving an address, while it runs: leaving the field and Continue share it. */
  private readonly running: { save: { base: string; result: Promise<SaveOutcome> } | null } = {
    save: null,
  };

  /** The self-hosted dialog's check: https:// only, except in a development build. */
  private readonly httpsOnly = onlyHttpsValidator();

  /** The address in the field, checked by the self-hosted dialog's rules. */
  private readonly checked = computed((): { base: string } | { refused: string } => {
    const typed = this.address().trim();
    if (typed === "") {
      return { refused: this.i18nService.t("keykeeperServerAddressNeeded") };
    }
    const refused = this.httpsOnly(new FormControl(typed));
    if (refused) {
      const [first] = Object.values(refused) as { message?: string }[];
      return { refused: first?.message ?? this.i18nService.t("keykeeperServerAddressInvalid") };
    }
    return { base: selfHostedAddress(typed) };
  });

  /**
   * Signing in can't go on: My own server is picked, and its address is blank
   * or one the self-hosted dialog would refuse.
   */
  readonly blocksSignIn = computed(
    () => this.ownServer() && !this.customAddresses() && "refused" in this.checked(),
  );

  constructor() {
    this.environmentService.globalEnvironment$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((env) => this.follow(env));
  }

  /** The switch and the field show the saved environment, whenever it changes. */
  private follow(env: Environment) {
    const region = env.getRegion();
    const urls = env.getUrls();
    const selfHosted = region === Region.SelfHosted;
    const base = selfHosted ? (urls.base ?? "") : "";
    this.selectedRegion.set(region);
    this.ownServer.set(selfHosted);
    this.customAddresses.set(
      selfHosted &&
        [urls.webVault, urls.api, urls.identity, urls.icons, urls.notifications, urls.events].some(
          (url) => !!url,
        ),
    );
    this.savedAddress.set(base);
    this.address.set(shownAddress(base));
    this.error.set(null);
  }

  protected typed(value: string) {
    this.address.set(value);
    this.error.set(null);
  }

  protected async pickCloud(region: RegionConfig) {
    this.ownServer.set(false);
    this.address.set("");
    this.error.set(null);
    await this.environmentService.setEnvironment(region.key);
  }

  protected pickOwnServer() {
    // What's saved, never an address typed earlier and not saved.
    this.address.set(shownAddress(this.savedAddress()));
    this.error.set(null);
    this.ownServer.set(true);
    // The field appears after this change; put the cursor in it, unless
    // focus has moved on by then (someone already typing elsewhere keeps it).
    const from = document.activeElement;
    setTimeout(() => {
      const now = document.activeElement;
      if (now === from || now === document.body || now == null) {
        this.addressInput()?.nativeElement.focus();
      }
    });
  }

  protected async editAddresses() {
    await SelfHostedEnvConfigDialogComponent.open(this.dialogService);
  }

  /** Saves the address when it's left or Enter is pressed; a blank field says nothing yet. */
  protected async saveAddress() {
    if (this.address().trim() === "") {
      this.error.set(null);
      return;
    }
    await this.commit();
  }

  /**
   * Before signing in goes on: saves the typed address when it isn't the saved
   * one yet, the way the self-hosted dialog saves its server URL, once a
   * server answers there. False, with the reason shown, when it can't be used.
   */
  async commit(): Promise<boolean> {
    if (!this.ownServer() || this.customAddresses()) {
      return true;
    }
    const checked = this.checked();
    if ("refused" in checked) {
      this.error.set(checked.refused);
      return false;
    }
    this.error.set(null);
    if (await this.isSaved(checked.base)) {
      return true;
    }
    this.checking.set(true);
    let outcome: SaveOutcome;
    try {
      outcome = await this.checkAndSave(checked.base);
    } finally {
      this.checking.set(false);
    }
    if (outcome === "saved") {
      return true;
    }
    // Typed over, or switched, meanwhile: the field has its own say now.
    if (outcome !== "changed") {
      this.error.set(
        outcome === "invalid"
          ? this.i18nService.t("keykeeperServerAddressInvalid")
          : this.problem(outcome),
      );
    }
    return false;
  }

  private async isSaved(base: string): Promise<boolean> {
    const current = await firstValueFrom(this.environmentService.globalEnvironment$);
    return current.getRegion() === Region.SelfHosted && current.getUrls().base === base;
  }

  /**
   * Asks the server at `base`, then saves it, unless the field shows another
   * address by then. One at a time for an address: leaving the field and
   * Continue share it.
   */
  private checkAndSave(base: string): Promise<SaveOutcome> {
    const running = this.running.save;
    if (running?.base === base) {
      return running.result;
    }
    const result: Promise<SaveOutcome> = (async (): Promise<SaveOutcome> => {
      const answer = await checkServer(base, this.fetchServer);
      const now = this.checked();
      if (!this.ownServer() || !("base" in now) || now.base !== base) {
        return "changed";
      }
      if ("problem" in answer) {
        return answer.problem;
      }
      if (await this.isSaved(base)) {
        return "saved";
      }
      try {
        await this.environmentService.setEnvironment(Region.SelfHosted, { base });
        return "saved";
      } catch (e) {
        this.logService.error(e);
        return "invalid";
      }
    })().finally(() => {
      if (this.running.save?.result === result) {
        this.running.save = null;
      }
    });
    this.running.save = { base, result };
    return result;
  }

  /** What's wrong with an address no server answered at as one should, and what to do. */
  private problem(problem: ServerProblem): string {
    switch (problem) {
      case "unreachable":
        return this.i18nService.t("keykeeperServerUnreachable");
      case "slow":
        return this.i18nService.t("keykeeperServerSlow");
      case "broken":
        return this.i18nService.t("keykeeperServerBroken");
      case "notAServer":
        return this.i18nService.t("keykeeperServerNotAServer", this.i18nService.t("appName"));
    }
  }
}

/**
 * A saved address as the field shows it: as the URL parser reads it (the host
 * in its punycode form), without https:// and a trailing slash.
 */
function shownAddress(base: string): string {
  if (!base) {
    return "";
  }
  const host = selfHostedAddressHost(base);
  if (!host) {
    return base;
  }
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  return (url.protocol === "https:" ? "" : url.protocol + "//") + host + path;
}
