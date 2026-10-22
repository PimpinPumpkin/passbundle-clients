import { ChangeDetectionStrategy, Component, effect, signal, viewChild } from "@angular/core";
import { Router } from "@angular/router";

import {
  DefaultImportMetadataService,
  ImportMetadataServiceAbstraction,
  ImportType,
} from "@bitwarden/importer-core";
import {
  ImportComponent,
  ImporterProviders,
  KeykeeperBrowserImportComponent,
  SYSTEM_SERVICE_PROVIDER,
} from "@bitwarden/importer-ui";
import { safeProvider } from "@bitwarden/ui-common";

import { SharedModule } from "../../shared";

import { SETUP_IMPORT } from "./setup-import-redirect.guard";

type SourceId = "browser" | "apple" | "onepassword" | "bitwarden" | "lastpass" | "other";

type Source = {
  id: SourceId;
  name: string;
  from: string;
  /** Upstream's importer for its export; none: the person picks. */
  format?: ImportType;
  /** The export, step by step, ending at "choose the file below". */
  steps?: string[];
};

const SOURCES: Source[] = [
  { id: "browser", name: "Your browser", from: "Chrome, Edge, Firefox, Brave, or Safari" },
  {
    id: "apple",
    name: "Apple Passwords",
    from: "The Passwords app on a Mac",
    // On a Mac, the browser import's Safari guide; elsewhere, these steps.
    format: "safaricsv",
    steps: [
      "On a Mac, open the Passwords app (in Applications), then choose File, then Export All Passwords to File.",
      "Choose Continue, confirm it's you, and save the file, Passwords.csv.",
      "Bring the file to this computer, such as on a USB drive, then delete it from the Mac.",
    ],
  },
  {
    id: "onepassword",
    name: "1Password",
    from: "A 1PUX export",
    format: "1password1pux",
    steps: [
      "In the 1Password app on your computer, choose File, then Export, then your account.",
      "Enter your 1Password password if it asks.",
      "Choose 1PUX as the format, then Export Data, and save the file.",
    ],
  },
  {
    id: "bitwarden",
    name: "Bitwarden",
    from: "A JSON export",
    format: "bitwardenjson",
    steps: [
      "In Bitwarden's web vault, open Tools, then Export vault.",
      "Choose .json as the file format (not the encrypted one), then Confirm format, and enter your master password.",
      "Save the file.",
    ],
  },
  {
    id: "lastpass",
    name: "LastPass",
    from: "A CSV export",
    format: "lastpasscsv",
    steps: [
      "Sign in to LastPass in your browser, and open Advanced options, then Export.",
      "Enter your LastPass master password, and save the file it downloads.",
    ],
  },
  { id: "other", name: "Something else", from: "Another password manager, or a CSV" },
];

/**
 * Keykeeper: right after signing up, an offer to bring passwords over before
 * the vault opens (DESIGN.md, "Importing from other password managers"). The browser
 * and Apple Passwords use the guided browser import; the other password
 * managers use upstream's importer, set to their export, with the steps to
 * make it. Skip is always there, and it isn't offered again.
 */
@Component({
  selector: "app-keykeeper-setup-import",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, ImportComponent, KeykeeperBrowserImportComponent],
  providers: [
    ...ImporterProviders,
    safeProvider({
      provide: ImportMetadataServiceAbstraction,
      useClass: DefaultImportMetadataService,
      deps: [SYSTEM_SERVICE_PROVIDER],
    }),
  ],
  template: `
    <section class="tw-mx-auto tw-mt-4 tw-max-w-3xl" data-testid="setup-import">
      @if (source(); as s) {
        <button
          type="button"
          bitLink
          startIcon="bwi-angle-left"
          class="tw-mb-4"
          (click)="source.set(null)"
        >
          Back
        </button>
        <h1 bitTypography="h2" class="tw-mb-4">From {{ s.name }}</h1>
        @if (s.id === "browser" || (s.id === "apple" && onMac)) {
          <tools-keykeeper-browser-import
            [startWith]="s.id === 'apple' ? 'safari' : null"
            (done)="finish()"
          ></tools-keykeeper-browser-import>
        } @else {
          @if (s.steps; as steps) {
            <h2 bitTypography="h5">1. Export from {{ s.name }}</h2>
            <ol class="tw-mb-4 tw-ps-6" [style.list-style-type]="'decimal'">
              @for (step of steps; track step) {
                <li bitTypography="body1">{{ step }}</li>
              }
            </ol>
            <h2 bitTypography="h5">2. Choose the file</h2>
          }
          <tools-import
            (formDisabled)="disabled.set($event)"
            (formLoading)="loading.set($event)"
            (onSuccessfulImport)="imported.set(true)"
          ></tools-import>
          @if (imported()) {
            <bit-callout type="warning" title="Delete the export now">
              It has every password in plain text. Delete the file, and empty the trash if it goes
              there.
            </bit-callout>
            <button bitButton buttonType="primary" type="button" (click)="finish()">
              Go to my vault
            </button>
          } @else {
            <button
              [disabled]="disabled()"
              [loading]="loading()"
              form="import_form_importForm"
              bitButton
              type="submit"
              buttonType="primary"
            >
              Import
            </button>
          }
        }
      } @else {
        <h1 bitTypography="h1" class="tw-mb-2 tw-text-center">Bring your passwords over</h1>
        <p bitTypography="body1" class="tw-mb-6 tw-text-center tw-text-muted">
          From wherever they are now. It takes a minute, and you can do it later from Tools, Import.
        </p>
        <div class="tw-grid tw-grid-cols-1 tw-gap-3 sm:tw-grid-cols-2 md:tw-grid-cols-3">
          @for (s of sources; track s.id) {
            <button
              type="button"
              class="tw-flex tw-flex-col tw-items-start tw-gap-1 tw-rounded-xl tw-border tw-border-solid tw-border-secondary-300 tw-bg-background tw-p-5 tw-text-start hover:tw-border-primary-600 focus-visible:tw-outline-primary-600"
              [attr.data-source]="s.id"
              (click)="source.set(s)"
            >
              <span bitTypography="h5" class="tw-mb-0">{{ s.name }}</span>
              <span bitTypography="body2" class="tw-text-muted">{{ s.from }}</span>
            </button>
          }
        </div>
      }
      <div class="tw-mt-8 tw-text-center">
        <button type="button" bitLink (click)="finish()">Skip for now</button>
      </div>
    </section>
  `,
})
export class KeykeeperSetupImportComponent {
  protected readonly sources = SOURCES;
  protected readonly onMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
  protected readonly source = signal<Source | null>(null);
  protected readonly loading = signal(false);
  protected readonly disabled = signal(false);
  protected readonly imported = signal(false);
  private readonly importer = viewChild(ImportComponent);

  constructor(private readonly router: Router) {
    // Upstream's importer, set to the chosen password manager's export.
    effect(() => {
      const format = this.source()?.format;
      const importer = this.importer();
      if (format != null && importer != null) {
        importer.formGroup.controls.format.setValue(format);
      }
    });
  }

  /** Done here, or skipped: not offered again, and on to the vault. */
  protected async finish() {
    try {
      sessionStorage.removeItem(SETUP_IMPORT);
    } catch {
      // Nothing kept to forget.
    }
    await this.router.navigate(["/vault"]);
  }
}
