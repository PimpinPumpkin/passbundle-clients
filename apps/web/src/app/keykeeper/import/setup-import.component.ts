import { ChangeDetectionStrategy, Component, computed, signal } from "@angular/core";
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
  /** Another export the source makes, offered under the steps for the recommended one. */
  other?: {
    /** The link to it, and back. */
    offer: string;
    back: string;
    format: ImportType;
    steps: string[];
  };
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
    from: "A 1PUX or CSV export",
    format: "1password1pux",
    steps: [
      "In the 1Password app on your computer, choose File, then Export, then your account.",
      "Enter your 1Password password if it asks.",
      "Choose 1PUX as the format, then Export Data, and save the file.",
    ],
    // 1PUX brings everything; a CSV, only logins and passwords.
    other: {
      offer: "Have a CSV from 1Password instead?",
      back: "Use a 1PUX export instead (recommended)",
      format: "1password8csv",
      steps: [
        "In the 1Password app on your computer, choose File, then Export, then your account.",
        "Enter your 1Password password if it asks.",
        "Choose CSV as the format, then Export Data, and save the file. A CSV has only logins and passwords; a 1PUX export brings cards, identities, secure notes, and custom fields too.",
      ],
    },
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
          (click)="choose(null)"
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
          @if (path().steps; as steps) {
            <h2 bitTypography="h5">1. Export from {{ s.name }}</h2>
            <ol class="tw-mb-4 tw-ps-6" [style.list-style-type]="'decimal'">
              @for (step of steps; track step) {
                <li bitTypography="body1">{{ step }}</li>
              }
            </ol>
            @if (s.other; as other) {
              <button
                type="button"
                bitLink
                class="tw-mb-4"
                data-testid="setup-import-other-export"
                (click)="toggleOther()"
              >
                {{ useOther() ? other.back : other.offer }}
              </button>
            }
            <h2 bitTypography="h5">2. Choose the file</h2>
          }
          <!-- A new importer for each source and export, started on its format. -->
          @for (key of [s.id + ":" + (path().format ?? "")]; track key) {
            <tools-import
              [startFormat]="path().format ?? null"
              (formDisabled)="disabled.set($event)"
              (formLoading)="loading.set($event)"
              (onSuccessfulImport)="imported.set(true)"
            ></tools-import>
          }
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
              (click)="choose(s)"
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
  /** The source's other export (1Password's CSV) rather than its recommended one. */
  protected readonly useOther = signal(false);
  /** The export being imported: its format and steps. */
  protected readonly path = computed(() => {
    const s = this.source();
    const other = this.useOther() ? s?.other : null;
    return other ?? { format: s?.format, steps: s?.steps };
  });
  protected readonly loading = signal(false);
  protected readonly disabled = signal(false);
  protected readonly imported = signal(false);
  constructor(private readonly router: Router) {}

  protected choose(source: Source | null) {
    this.useOther.set(false);
    this.imported.set(false);
    this.source.set(source);
  }

  protected toggleOther() {
    this.useOther.set(!this.useOther());
    this.imported.set(false);
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
