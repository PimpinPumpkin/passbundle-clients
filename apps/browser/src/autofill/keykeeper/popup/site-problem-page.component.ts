import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import {
  ButtonModule,
  CalloutModule,
  FormFieldModule,
  TypographyModule,
} from "@bitwarden/components";

import { BrowserApi } from "../../../platform/browser/browser-api";
import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";
import { AutofillTriageResponse } from "../../types/autofill-triage";
import { hostOf } from "../fill-rules";

/** One field as a report describes it: its shape, never its value. */
export type ReportedField = {
  id: string;
  name: string;
  label: string;
  type: string;
  autocomplete: string;
};

/**
 * Keykeeper: "Report a problem with this site". Sends the account's server
 * the site in the current tab and the shape of its fields (type, id, name,
 * label, autocomplete hint; never values), with an optional note, and shows
 * exactly that first. See DESIGN.md, "Site fixes (opt-in)".
 */
@Component({
  selector: "app-keykeeper-site-problem-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonModule,
    CalloutModule,
    FormFieldModule,
    FormsModule,
    PopupHeaderComponent,
    PopupPageComponent,
    TypographyModule,
  ],
  template: `
    <popup-page>
      <popup-header slot="header" pageTitle="Report a problem" showBackButton></popup-header>
      <section class="tw-px-1 tw-py-2" data-testid="site-problem">
        @if (sent()) {
          <bit-callout type="success" [title]="null">
            Sent. Thank you: reports like this tell us which sites need work.
          </bit-callout>
        } @else if (host(); as site) {
          <p bitTypography="body2">
            This sends your server the site, <strong>{{ site }}</strong>, and these fields'
            types, ids, names, and labels. Never what's in them.
          </p>
          <ul class="tw-mb-3 tw-ps-4 tw-text-sm" data-testid="site-problem-fields">
            @for (field of fields(); track $index) {
              <li class="tw-font-mono">{{ describe(field) }}</li>
            } @empty {
              <li>No fields found on this page.</li>
            }
          </ul>
          <bit-form-field>
            <bit-label>What went wrong? (optional)</bit-label>
            <textarea bitInput rows="3" maxlength="1000" [(ngModel)]="note"></textarea>
          </bit-form-field>
          @if (error(); as message) {
            <bit-callout type="danger" [title]="null">{{ message }}</bit-callout>
          }
          <button bitButton buttonType="primary" type="button" (click)="send()">Send report</button>
        } @else {
          <p bitTypography="body2">Open the website you're having trouble with first.</p>
        }
      </section>
    </popup-page>
  `,
})
export class KeykeeperSiteProblemPageComponent implements OnInit {
  protected readonly host = signal<string | null>(null);
  protected readonly fields = signal<ReportedField[]>([]);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly note = "";

  constructor(private readonly apiService: ApiService) {}

  async ngOnInit() {
    const tab = await BrowserApi.getTabFromCurrentWindow();
    if (tab?.url == null || !/^https?:/.test(tab.url)) {
      return;
    }
    this.host.set(hostOf(tab.url));
    const response = await BrowserApi.tabSendMessage<unknown, AutofillTriageResponse>(
      tab,
      { command: "collectAutofillTriage" },
      { frameId: 0 },
    ).catch((): null => null);
    this.fields.set(
      (response?.pageDetails?.fields ?? []).slice(0, 50).map((f) => ({
        id: f.htmlID ?? "",
        name: f.htmlName ?? "",
        label: f["label-tag"] || f["label-aria"] || f.placeholder || "",
        type: f.type ?? "",
        autocomplete: f.autoCompleteType ?? "",
      })),
    );
  }

  protected describe(field: ReportedField): string {
    return [field.type, field.id, field.name, field.label, field.autocomplete]
      .filter((part) => part !== "")
      .join(" · ");
  }

  protected async send() {
    try {
      await this.apiService.send(
        "POST",
        "/keykeeper/site-problems",
        { host: this.host(), fields: this.fields(), note: this.note.trim() || undefined },
        true,
        true,
      );
      this.sent.set(true);
    } catch (e) {
      this.error.set(e instanceof ErrorResponse ? e.getSingleMessage() : "Couldn't send the report.");
    }
  }
}
