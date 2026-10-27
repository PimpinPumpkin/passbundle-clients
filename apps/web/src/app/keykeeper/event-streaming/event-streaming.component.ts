import { ChangeDetectionStrategy, Component, effect, input, output, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";

import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperConfirmChangeService } from "../confirm-change/confirm-change.service";

import {
  Destination,
  DestinationKind,
  DestinationList,
  emptyForm,
  formFor,
  KIND_NAMES,
  queueNote,
  requestFor,
  SIGNING_HELP,
  statusView,
  StreamingScope,
} from "./event-streaming";
import { KeykeeperEventStreamingApiService } from "./event-streaming-api.service";

/** A signing secret just made, shown once. */
type Made = { name: string; secret: string };

/**
 * Keykeeper: the places an organization's events (or an MSP's: every
 * client's, and its own activity) are sent, its security tools. Used on the
 * organization's Event streaming page and in the MSP console. The server
 * answers only owners and admins (not MSP technicians) and MSP admins; for
 * anyone else this says who can. Adding, changing, turning on or off, and a
 * new signing secret ask the person to confirm it's them first. See
 * DESIGN.md, "Sending events to security tools".
 */
@Component({
  selector: "app-keykeeper-event-streaming",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <section data-testid="event-streaming" class="tw-max-w-5xl">
      @if (heading()) {
        <h2 bitTypography="h3">Event streaming</h2>
      }
      <p bitTypography="body1">
        @if (scope().kind === "msp") {
          Send every client's events, and this MSP's own activity, to your SOC's SIEM or MDR service
          as they happen. Each event says which client it's from.
        } @else {
          Send this organization's events to your SIEM or MDR service (Huntress, Blumira, Microsoft
          Sentinel, and others) as they happen.
        }
        Events name people by email and items by id, never what's in the vault.
      </p>

      @if (refused()) {
        <bit-callout type="info" [title]="null" data-testid="event-streaming-refused">
          Only the organization's owners and admins, and its MSP's admins, choose where its events
          go.
        </bit-callout>
      }

      @if (made(); as m) {
        <bit-callout
          type="success"
          title="Copy the signing secret now"
          data-testid="event-streaming-secret"
        >
          <p class="tw-mb-2">
            This is the only time {{ m.name }}'s signing secret is shown. Give it to whatever
            receives the webhook, so it can check that each event came from here.
          </p>
          <pre
            class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
            data-testid="event-streaming-secret-value"
            >{{ m.secret }}</pre>
          <p class="tw-mb-2 tw-text-sm">{{ signingHelp }}</p>
          <div class="tw-flex tw-gap-2">
            <button bitButton buttonType="primary" type="button" (click)="copy(m.secret)">
              Copy secret
            </button>
            <button bitButton buttonType="secondary" type="button" (click)="made.set(null)">
              Done
            </button>
          </div>
        </bit-callout>
      }

      @if (list(); as l) {
        @if (l.data.length === 0) {
          <p bitTypography="body2" class="tw-text-muted">Events aren't sent anywhere yet.</p>
        } @else {
          <bit-table>
            <ng-container header>
              <tr>
                <th bitCell>Name</th>
                <th bitCell>Where</th>
                <th bitCell>Status</th>
                <th bitCell>Last delivered</th>
                <th bitCell></th>
              </tr>
            </ng-container>
            <ng-template body>
              @for (d of l.data; track d.id) {
                <tr bitRow [attr.data-testid]="'destination-' + d.name">
                  <td bitCell>
                    {{ d.name }}
                    <div class="tw-text-sm tw-text-muted">{{ kindName(d.kind) }}</div>
                  </td>
                  <td bitCell class="tw-break-all">{{ d.target }}</td>
                  <td bitCell>
                    @if (status(d); as s) {
                      <span bitBadge [variant]="s.variant" data-testid="destination-status">{{
                        s.label
                      }}</span>
                      @if (s.detail) {
                        <div class="tw-mt-1 tw-text-sm" data-testid="destination-detail">
                          {{ s.detail }}
                        </div>
                      }
                    }
                    @if (queueNote(d); as q) {
                      <div class="tw-mt-1 tw-text-sm tw-text-muted">{{ q }}</div>
                    }
                  </td>
                  <td bitCell>
                    @if (d.lastSuccessAt) {
                      {{ d.lastSuccessAt | date: "medium" }}
                    } @else {
                      Not yet
                    }
                  </td>
                  <td bitCell class="tw-whitespace-nowrap tw-text-right">
                    <button
                      type="button"
                      bitLink
                      class="tw-mr-3"
                      [attr.aria-label]="'Send a test event to ' + d.name"
                      (click)="test(d)"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      bitLink
                      class="tw-mr-3"
                      [attr.aria-label]="'Edit ' + d.name"
                      (click)="edit(d)"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      bitLink
                      class="tw-mr-3"
                      [attr.aria-label]="(d.enabled ? 'Turn off ' : 'Turn on ') + d.name"
                      (click)="setEnabled(d, !d.enabled)"
                    >
                      {{ d.enabled ? "Turn off" : "Turn on" }}
                    </button>
                    @if (d.kind === "webhook") {
                      <button
                        type="button"
                        bitLink
                        class="tw-mr-3"
                        [attr.aria-label]="'New signing secret for ' + d.name"
                        (click)="newSecret(d)"
                      >
                        New secret
                      </button>
                    }
                    <button
                      type="button"
                      bitLink
                      linkType="danger"
                      [attr.aria-label]="'Remove ' + d.name"
                      (click)="remove(d)"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              }
            </ng-template>
          </bit-table>
        }

        @if (editing() === undefined) {
          @if (l.data.length < l.maxDestinations) {
            <button bitButton buttonType="secondary" type="button" class="tw-mt-4" (click)="add()">
              Add a destination
            </button>
          }
        } @else {
          <form
            [formGroup]="form"
            [bitSubmit]="save"
            [attr.aria-label]="editing() ? 'Edit destination' : 'New destination'"
            class="tw-mt-4 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
          >
            <h3 bitTypography="h5">
              {{ editing() ? "Edit " + editing()!.name : "Add a destination" }}
            </h3>
            <div class="tw-grid tw-grid-cols-1 tw-gap-x-4 md:tw-grid-cols-2">
              <bit-form-field>
                <bit-label>Name</bit-label>
                <input bitInput formControlName="name" placeholder="Huntress SIEM" />
              </bit-form-field>
              <bit-form-field>
                <bit-label>Kind</bit-label>
                <select bitInput formControlName="kind">
                  @for (k of kinds; track k) {
                    <option [ngValue]="k">{{ kindName(k) }}</option>
                  }
                </select>
              </bit-form-field>
            </div>

            @switch (form.controls.kind.value) {
              @case ("webhook") {
                <bit-form-field>
                  <bit-label>URL</bit-label>
                  <!-- Hidden like a password: collectors often put their token in it. -->
                  <input
                    bitInput
                    formControlName="url"
                    type="password"
                    autocomplete="new-password"
                    placeholder="https://"
                  />
                  <button type="button" bitIconButton bitSuffix bitPasswordInputToggle></button>
                  <bit-hint>
                    @if (editing()) {
                      Leave blank to keep {{ editing()!.target }}.
                    }
                    HTTPS only. The server signs each event; a token in the URL stays hidden.
                  </bit-hint>
                </bit-form-field>
                <div class="tw-grid tw-grid-cols-1 tw-gap-x-4 md:tw-grid-cols-2">
                  <bit-form-field>
                    <bit-label>Header (optional)</bit-label>
                    <input bitInput formControlName="headerName" placeholder="Authorization" />
                    <bit-hint>For a collector that wants a token in a header.</bit-hint>
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Header value</bit-label>
                    <input
                      bitInput
                      formControlName="headerValue"
                      type="password"
                      autocomplete="new-password"
                    />
                    <button type="button" bitIconButton bitSuffix bitPasswordInputToggle></button>
                    @if (editing()) {
                      <bit-hint>
                        Leave blank to keep it. Changing the URL, the header, or the certificate
                        authority asks for it again.
                      </bit-hint>
                    }
                  </bit-form-field>
                </div>
              }
              @case ("syslog") {
                <div class="tw-grid tw-grid-cols-1 tw-gap-x-4 md:tw-grid-cols-3">
                  <bit-form-field>
                    <bit-label>Collector host</bit-label>
                    <input bitInput formControlName="host" placeholder="siem.example.com" />
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Port</bit-label>
                    <input bitInput formControlName="port" type="number" min="1" max="65535" />
                    <bit-hint>Syslog over TLS is usually 6514.</bit-hint>
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Message format</bit-label>
                    <select bitInput formControlName="format">
                      <option ngValue="json">JSON</option>
                      <option ngValue="cef">CEF</option>
                    </select>
                  </bit-form-field>
                </div>
              }
              @case ("sentinel") {
                <p bitTypography="body2">
                  Events go to a custom table through Azure Monitor's Logs Ingestion API, signed in
                  as an app registration with the Monitoring Metrics Publisher role on the data
                  collection rule.
                </p>
                <div class="tw-grid tw-grid-cols-1 tw-gap-x-4 md:tw-grid-cols-2">
                  <bit-form-field>
                    <bit-label>Directory (tenant) ID</bit-label>
                    <input bitInput formControlName="tenantId" />
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Application (client) ID</bit-label>
                    <input bitInput formControlName="clientId" />
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Client secret</bit-label>
                    <input
                      bitInput
                      formControlName="clientSecret"
                      type="password"
                      autocomplete="new-password"
                    />
                    <button type="button" bitIconButton bitSuffix bitPasswordInputToggle></button>
                    @if (editing()) {
                      <bit-hint>
                        Leave blank to keep it. Changing the tenant, the app, or the endpoint asks
                        for it again.
                      </bit-hint>
                    }
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Logs ingestion endpoint</bit-label>
                    <input
                      bitInput
                      formControlName="endpoint"
                      placeholder="https://….ingest.monitor.azure.com"
                    />
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Data collection rule's immutable ID</bit-label>
                    <input bitInput formControlName="ruleId" placeholder="dcr-…" />
                  </bit-form-field>
                  <bit-form-field>
                    <bit-label>Stream</bit-label>
                    <input bitInput formControlName="stream" />
                  </bit-form-field>
                </div>
              }
            }

            @if (form.controls.kind.value !== "sentinel") {
              <bit-form-field>
                <bit-label>Certificate authority (optional)</bit-label>
                <textarea
                  bitInput
                  rows="3"
                  formControlName="caCertificate"
                  placeholder="-----BEGIN CERTIFICATE-----"
                ></textarea>
                <bit-hint>
                  Only for a collector whose certificate comes from your own CA. Leave it blank for
                  a public certificate.
                  @if (editing() && form.controls.kind.value === "webhook") {
                    Changing it asks for the URL again.
                  }
                </bit-hint>
              </bit-form-field>
            }
            @if (list()?.privateNetworks === false) {
              <p bitTypography="body2" class="tw-text-muted">
                Events go only to public addresses. A self-hosted server's admin can allow chosen
                private ones.
              </p>
            }

            <div class="tw-flex tw-gap-2">
              <button bitButton bitFormButton buttonType="primary" type="submit">
                {{ editing() ? "Save" : "Add" }}
              </button>
              <button bitButton buttonType="secondary" type="button" (click)="cancel()">
                Cancel
              </button>
            </div>
          </form>
        }
      }
    </section>
  `,
})
export class KeykeeperEventStreamingComponent {
  readonly scope = input.required<StreamingScope>();
  /** Shows the section's own heading (the MSP console); a page has its own. */
  readonly heading = input(false);
  /** After a change, which the MSP console's activity log then shows. */
  readonly changed = output<void>();

  protected readonly list = signal<DestinationList | null>(null);
  protected readonly refused = signal(false);
  protected readonly made = signal<Made | null>(null);
  /** undefined: not editing; null: adding; a destination: editing it. */
  protected readonly editing = signal<Destination | null | undefined>(undefined);
  protected readonly kinds: DestinationKind[] = ["webhook", "syslog", "sentinel"];
  protected readonly signingHelp = SIGNING_HELP;
  protected readonly status = statusView;
  protected readonly queueNote = queueNote;

  protected readonly form = this.formBuilder.nonNullable.group(emptyForm());

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperEventStreamingApiService,
    private readonly toastService: ToastService,
    private readonly dialogService: DialogService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly confirmChange: KeykeeperConfirmChangeService,
  ) {
    effect(() => {
      void this.load(this.scope());
    });
  }

  protected kindName(kind: DestinationKind) {
    return KIND_NAMES[kind];
  }

  private async load(scope: StreamingScope) {
    try {
      this.list.set(await this.api.list(scope));
      this.refused.set(false);
    } catch (e) {
      if (e instanceof ErrorResponse && e.statusCode === 404) {
        this.refused.set(true);
        this.list.set(null);
        return;
      }
      throw e;
    }
  }

  private async attempt(work: () => Promise<void>) {
    try {
      await work();
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }

  protected add() {
    this.form.reset(emptyForm());
    this.form.controls.kind.enable();
    this.editing.set(null);
  }

  protected edit(d: Destination) {
    this.form.reset(formFor(d));
    // A destination's kind can't change.
    this.form.controls.kind.disable();
    this.editing.set(d);
  }

  protected cancel() {
    this.editing.set(undefined);
  }

  protected readonly save = async () => {
    const editing = this.editing() ?? null;
    const scope = this.scope();
    const request = requestFor(this.form.getRawValue(), editing);
    await this.attempt(async () => {
      const saved = await this.confirmChange.send("keykeeperConfirmEventDestination", (v) =>
        editing
          ? this.api.update(scope, editing.id, request, v)
          : this.api.create(scope, request, v),
      );
      if (saved == null) {
        // Still editing.
        return;
      }
      if (saved.signingSecret) {
        this.made.set({ name: saved.name, secret: saved.signingSecret });
      }
      this.editing.set(undefined);
      this.toastService.showToast({
        variant: "success",
        message: editing ? `Saved ${saved.name}` : `Events now go to ${saved.name}`,
      });
      await this.load(this.scope());
      this.changed.emit();
    });
  };

  protected async test(d: Destination) {
    await this.attempt(async () => {
      const result = await this.api.test(this.scope(), d.id);
      this.toastService.showToast(
        result.warning
          ? { variant: "warning", message: `Sent a test event to ${d.name}. ${result.warning}` }
          : { variant: "success", message: `Sent a test event to ${d.name}` },
      );
    });
    // And how it's doing now.
    await this.attempt(() => this.load(this.scope()));
  }

  protected async setEnabled(d: Destination, enabled: boolean) {
    if (!enabled) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: `Turn off ${d.name}?`,
        content:
          "Events stop going there, and the ones waiting are dropped. They stay in the event log.",
        acceptButtonText: "Turn off",
        type: "warning",
      });
      if (!confirmed) {
        return;
      }
    }
    const scope = this.scope();
    await this.attempt(async () => {
      const saved = await this.confirmChange.send("keykeeperConfirmEventDestination", (v) =>
        this.api.setEnabled(scope, d.id, enabled, v),
      );
      if (saved == null) {
        return;
      }
      this.toastService.showToast({
        variant: "success",
        message: enabled ? `${d.name} is on` : `${d.name} is off`,
      });
      await this.load(this.scope());
      this.changed.emit();
    });
  }

  protected async newSecret(d: Destination) {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `New signing secret for ${d.name}?`,
      content: "The current secret stops working at once, so update the receiver right away.",
      acceptButtonText: "Make a new secret",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    const scope = this.scope();
    await this.attempt(async () => {
      const saved = await this.confirmChange.send("keykeeperConfirmSigningSecret", (v) =>
        this.api.newSecret(scope, d.id, v),
      );
      if (saved == null) {
        return;
      }
      this.made.set({ name: saved.name, secret: saved.signingSecret ?? "" });
      await this.load(this.scope());
      this.changed.emit();
    });
  }

  protected async remove(d: Destination) {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Remove ${d.name}?`,
      content: "Events stop going there. Removing it is recorded in the event log.",
      acceptButtonText: "Remove",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    await this.attempt(async () => {
      await this.api.remove(this.scope(), d.id);
      this.toastService.showToast({ variant: "success", message: `Removed ${d.name}` });
      await this.load(this.scope());
      this.changed.emit();
    });
  }

  protected copy(text: string) {
    this.platformUtilsService.copyToClipboard(text);
    this.toastService.showToast({ variant: "success", message: "Copied" });
  }
}
