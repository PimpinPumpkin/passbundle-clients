import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  OnInit,
  output,
  signal,
} from "@angular/core";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import {
  AsyncActionsModule,
  ButtonModule,
  CalloutModule,
  TypographyModule,
} from "@bitwarden/components";

import { ImportResult } from "../../models/import-result";
import { ImportServiceAbstraction } from "../../services";

import {
  BrowserId,
  browsersFor,
  deleteSteps,
  detectBrowser,
  detectComputer,
  guideFor,
  PreparedImport,
  prepareImport,
} from "./browser-import";

/**
 * Keykeeper: guided import from a browser's own password manager, the same in
 * the web vault and the extension. It shows the export steps for the person's
 * browser and computer, imports the file with upstream's importer for that
 * browser into their own vault, leaves out what's already there, sets aside
 * logins whose password differs, and then says to delete the export. See
 * browser-import.ts and DESIGN.md, "Browser import".
 */
@Component({
  selector: "tools-keykeeper-browser-import",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncActionsModule, ButtonModule, CalloutModule, TypographyModule],
  template: `
    <section class="tw-max-w-2xl" data-testid="browser-import">
      @if (summary(); as s) {
        <h2 bitTypography="h4">Imported from {{ guide().name }}</h2>
        <p bitTypography="body1" data-testid="browser-import-summary">{{ summaryText(s) }}</p>
        <bit-callout type="warning" title="Delete the export now">
          It has every password in plain text. {{ deleteText() }}
        </bit-callout>
        <p bitTypography="body2" data-testid="browser-import-turn-off">
          So {{ guide().name }} stops offering to save passwords: {{ guide().turnOff }}
        </p>
        <button bitButton buttonType="primary" type="button" (click)="done.emit()">Done</button>
      } @else {
        <p bitTypography="body1">
          Bring your saved passwords over from your browser: export them there, then choose the file
          here.
        </p>
        <div
          class="tw-mb-4 tw-flex tw-flex-wrap tw-gap-2"
          role="radiogroup"
          aria-label="Your browser"
        >
          @for (id of browsers(); track id) {
            <button
              bitButton
              type="button"
              role="radio"
              [buttonType]="id === browser() ? 'primary' : 'secondary'"
              [attr.aria-checked]="id === browser()"
              (click)="choose(id)"
            >
              {{ nameOf(id) }}
            </button>
          }
        </div>
        <h2 bitTypography="h5">1. Export your passwords from {{ guide().name }}</h2>
        <ol
          class="tw-mb-3 tw-ps-6"
          [style.list-style-type]="'decimal'"
          data-testid="browser-import-steps"
        >
          @for (step of guide().steps; track step) {
            <li bitTypography="body2">{{ step }}</li>
          }
        </ol>
        @if (canOpen()) {
          <button
            bitButton
            buttonType="secondary"
            type="button"
            class="tw-mb-4"
            (click)="openPasswordsPage()!(guide().passwordsPage!)"
          >
            Open {{ guide().name }}'s passwords
          </button>
        }
        <h2 bitTypography="h5">2. Choose the file</h2>
        <p bitTypography="body2">
          It's called {{ guide().fileName }}, unless you named it something else.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          class="tw-mb-4 tw-block"
          aria-label="The exported file"
          data-testid="browser-import-file"
          (change)="pick($event)"
        />
        @if (error(); as message) {
          <bit-callout type="danger" data-testid="browser-import-error">{{ message }}</bit-callout>
        }
        <button
          bitButton
          buttonType="primary"
          type="button"
          [disabled]="file() == null"
          [bitAction]="importFile"
        >
          Import
        </button>
      }
    </section>
  `,
})
export class KeykeeperBrowserImportComponent implements OnInit {
  /**
   * Opens the browser's passwords page, where the app may (the extension can
   * open a Chromium browser's own pages; a web page can't).
   */
  readonly openPasswordsPage = input<((url: string) => void) | null>(null);
  readonly done = output<void>();
  /** The browser to start on, where it's offered (Safari for Apple Passwords, say). */
  readonly startWith = input<BrowserId | null>(null);

  private readonly userAgent = globalThis.navigator?.userAgent ?? "";
  private readonly computer = detectComputer(this.userAgent);
  private readonly detected = detectBrowser(
    this.userAgent,
    (
      globalThis.navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
    )?.userAgentData?.brands?.map((b) => b.brand) ?? [],
  );

  protected readonly browsers = signal(browsersFor(this.computer));
  protected readonly browser = signal<BrowserId>(
    this.browsers().includes(this.detected) ? this.detected : "chrome",
  );
  protected readonly guide = computed(() => guideFor(this.browser(), this.computer));
  protected readonly canOpen = computed(
    () =>
      this.openPasswordsPage() != null &&
      this.browser() === this.detected &&
      this.guide().passwordsPage?.startsWith(`${this.browser()}://`) === true,
  );
  protected readonly file = signal<File | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly summary = signal<PreparedImport | null>(null);

  constructor(
    private readonly importService: ImportServiceAbstraction,
    private readonly cipherService: CipherService,
    private readonly accountService: AccountService,
  ) {}

  ngOnInit() {
    const start = this.startWith();
    if (start != null && this.browsers().includes(start)) {
      this.browser.set(start);
    }
  }

  protected nameOf(id: BrowserId): string {
    return guideFor(id, this.computer).name;
  }

  protected choose(id: BrowserId) {
    this.browser.set(id);
    this.error.set(null);
  }

  protected pick(event: Event) {
    this.file.set((event.target as HTMLInputElement).files?.[0] ?? null);
    this.error.set(null);
  }

  protected deleteText(): string {
    return deleteSteps(this.file()?.name ?? this.guide().fileName, this.computer);
  }

  protected summaryText(s: PreparedImport): string {
    const logins = (n: number) => (n === 1 ? "1 login" : `${n} logins`);
    const parts = [`Imported ${logins(s.added + s.toCheck)}.`];
    if (s.alreadyThere > 0) {
      parts.push(
        `${s.alreadyThere === 1 ? "1 was" : `${s.alreadyThere} were`} already in your vault.`,
      );
    }
    if (s.toCheck > 0) {
      parts.push(
        `${s.toCheck === 1 ? "1 has" : `${s.toCheck} have`} a different password from a login you have for the same site, so ${s.toCheck === 1 ? "it's" : "they're"} in the folder "${this.checkFolder()}" for you to compare.`,
      );
    }
    if (s.empty > 0) {
      parts.push(
        `${s.empty === 1 ? "1 had" : `${s.empty} had`} no password and ${s.empty === 1 ? "was" : "were"} skipped.`,
      );
    }
    return parts.join(" ");
  }

  private checkFolder(): string {
    return `Check these: from ${this.guide().name}`;
  }

  protected readonly importFile = async () => {
    const file = this.file();
    if (file == null) {
      return;
    }
    const guide = this.guide();
    const importer = this.importService.getImporter(guide.format, () => Promise.resolve(""), null);
    const parsed = await importer.parse(await file.text()).catch((): ImportResult | null => null);
    if (parsed == null || !parsed.success || parsed.ciphers.length === 0) {
      this.error.set(
        `That file doesn't look like a ${guide.name} export. Export again with the steps above, or choose your browser above if it's a different one.`,
      );
      return;
    }
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const prepared = prepareImport(
      parsed,
      await this.cipherService.getAllDecrypted(userId),
      this.checkFolder(),
    );
    if (prepared.result.ciphers.length > 0) {
      await this.importService.importImportResult(prepared.result);
    }
    this.summary.set(prepared);
  };
}
