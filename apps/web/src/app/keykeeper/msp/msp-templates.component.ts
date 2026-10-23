import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, FormControl, FormGroup } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import {
  knownItems,
  TemplateRow,
  templateRows,
  templateSourceProblem,
  templateStatus,
  templateTargets,
} from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogService, ToastService } from "@bitwarden/components";
import { customTemplate, templateDefinition } from "@bitwarden/vault";

import { SharedModule } from "../../shared";

import { KeykeeperMspApiService, MspDetails, MspTemplates } from "./msp-api.service";
import { clientList } from "./msp-policies";
import { KeykeeperMspWorkService, KeykeeperTemplateSenderService } from "./msp-work.service";
import { KeykeeperTemplateClientsDialogComponent } from "./template-clients-dialog.component";

/**
 * Keykeeper: the item templates an MSP's clients get. A template here applies
 * automatically to every client (including clients added later) or to chosen
 * ones; any MSP admin's web vault keeps the clients' copies current, so people
 * only edit the template itself. See DESIGN.md, "MSP templates".
 */
@Component({
  selector: "app-keykeeper-msp-templates",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <section class="tw-mb-8" aria-label="Templates" data-testid="msp-templates">
      <h2 bitTypography="h3">Templates</h2>
      <p bitTypography="body2">
        Templates here apply to your clients automatically, including clients you add later. Each
        client has them in its Templates shared folder. To change one, edit it, and your clients get
        the change. Use Clients to change which clients get one.
      </p>
      @if (rows().length === 0) {
        <p bitTypography="body2" class="tw-text-muted">No templates yet.</p>
      } @else {
        <bit-table>
          <ng-container header>
            <tr>
              <th bitCell>Template</th>
              <th bitCell>Applies to</th>
              <th bitCell>Status</th>
              <th bitCell></th>
            </tr>
          </ng-container>
          <ng-template body>
            @for (row of rows(); track row.templateId) {
              @let name = row.name ?? "A template you can't see";
              <tr bitRow [attr.data-testid]="'msp-template-' + name">
                <td bitCell>{{ name }}</td>
                <td bitCell>{{ targets(row) }}</td>
                <td bitCell data-testid="msp-template-status">{{ status(row) }}</td>
                <td bitCell class="tw-whitespace-nowrap tw-text-right">
                  @if (isAdmin()) {
                    @if (row.sourceVisible) {
                      <a
                        bitLink
                        class="tw-mr-3"
                        [routerLink]="['/vault']"
                        [queryParams]="{ itemId: row.sourceCipherId, action: 'edit' }"
                        [attr.aria-label]="'Edit ' + name"
                      >
                        Edit
                      </a>
                      <button
                        type="button"
                        bitLink
                        class="tw-mr-3"
                        [attr.aria-label]="'Change clients for ' + name"
                        (click)="changeClients(row)"
                      >
                        Clients
                      </button>
                      @if (row.behind.length > 0) {
                        <button
                          type="button"
                          bitLink
                          class="tw-mr-3"
                          [attr.aria-label]="'Update ' + name"
                          (click)="update(row)"
                        >
                          Update
                        </button>
                      }
                    }
                    <button
                      type="button"
                      bitLink
                      [attr.aria-label]="'Remove ' + name"
                      (click)="remove(row)"
                    >
                      Remove
                    </button>
                  }
                </td>
              </tr>
            }
          </ng-template>
        </bit-table>
      }

      @if (isAdmin()) {
        <form
          [formGroup]="form"
          [bitSubmit]="add"
          class="tw-mt-4 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
          aria-label="Add a template"
        >
          <h3 bitTypography="h5">Add a template</h3>
          @if (candidates().length === 0) {
            <p bitTypography="body2" class="tw-mb-0">
              Make a template first: in your items, choose New, then From template, then Create
              template.
            </p>
          } @else {
            <bit-form-field>
              <bit-label>Template</bit-label>
              <select bitInput formControlName="source">
                @for (c of candidates(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
              <bit-hint
                >Your own templates and your organizations', never a client's copy.</bit-hint
              >
            </bit-form-field>
            <bit-radio-group formControlName="scope" [block]="true">
              <bit-label>Applies to</bit-label>
              <bit-radio-button value="all">
                <bit-label>Every client</bit-label>
                <bit-hint>Including clients added later.</bit-hint>
              </bit-radio-button>
              <bit-radio-button value="chosen">
                <bit-label>Only the clients chosen here</bit-label>
              </bit-radio-button>
            </bit-radio-group>
            @if (form.controls.scope.value === "chosen") {
              <div class="tw-mb-2 tw-ml-6" [formGroup]="chosen()">
                @for (client of msp().clients; track client.id) {
                  <bit-form-control>
                    <input type="checkbox" bitCheckbox [formControlName]="client.id" />
                    <bit-label>{{ client.name }}</bit-label>
                  </bit-form-control>
                }
              </div>
            }
            <button bitButton bitFormButton buttonType="primary" type="submit">Add template</button>
          }
        </form>
      }
    </section>
  `,
})
export class KeykeeperMspTemplatesComponent {
  readonly msp = input.required<MspDetails>();
  readonly templates = input.required<MspTemplates>();
  /** Templates or copies changed. */
  readonly changed = output<void>();

  /** The items the person can decrypt: sources, copies, and templates to choose from. */
  private readonly items = signal<CipherView[]>([]);

  protected readonly isAdmin = computed(() => this.msp().role === "admin");

  protected readonly rows = computed(() =>
    templateRows(
      this.templates(),
      this.msp().clients.map(({ id, name }) => ({ id, name })),
      knownItems(this.items()),
    ),
  );

  /** Templates an admin can add: their own and their organizations', never a client's copy. */
  protected readonly candidates = computed(() => {
    const clients = this.msp().clients.map((c) => c.id);
    return this.items()
      .filter((c) => customTemplate(c) != null && templateSourceProblem(c, clients) == null)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly form = this.formBuilder.group({
    source: [""],
    scope: ["all" as "all" | "chosen"],
  });
  /** A checkbox per client, for "Only the clients chosen here". */
  protected readonly chosen = signal(
    new FormGroup<Record<string, FormControl<boolean | null>>>({}),
  );

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly mspApi: KeykeeperMspApiService,
    private readonly sender: KeykeeperTemplateSenderService,
    private readonly work: KeykeeperMspWorkService,
    private readonly cipherService: CipherService,
    private readonly accountService: AccountService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {
    // Reload what the person can decrypt whenever the templates change.
    effect(() => {
      this.templates();
      void this.loadItems();
    });
    effect(() => {
      const ids = this.msp().clients.map((c) => c.id);
      this.chosen.set(
        new FormGroup(
          Object.fromEntries(ids.map((id) => [id, new FormControl<boolean | null>(false)])),
        ),
      );
    });
    effect(() => {
      const candidates = this.candidates();
      if (!candidates.some((c) => c.id === this.form.controls.source.value)) {
        this.form.controls.source.setValue(candidates[0]?.id ?? "");
      }
    });
    // Copies updated in the background, such as after the person edited a template.
    this.work.updated$
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.changed.emit());
  }

  protected targets(row: TemplateRow) {
    return templateTargets(row);
  }

  protected status(row: TemplateRow) {
    return templateStatus(row);
  }

  private async loadItems() {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    this.items.set(await this.cipherService.getAllDecrypted(userId));
  }

  protected readonly add = async () => {
    const source = this.items().find((c) => c.id === this.form.controls.source.value);
    const definition = templateDefinition(source);
    if (source == null || definition == null) {
      return;
    }
    const allClients = this.form.controls.scope.value === "all";
    const chosen = allClients
      ? []
      : Object.entries(this.chosen().value)
          .filter(([, on]) => on)
          .map(([id]) => id);
    if (!allClients && chosen.length === 0) {
      this.toast("error", "Choose at least one client.");
      return;
    }
    await this.attempt(async () => {
      const m = this.msp();
      await this.mspApi.setTemplate(m.id, definition.id, {
        sourceCipherId: source.id,
        allClients,
        clients: chosen,
      });
      const failures = await this.work.run(true);
      const names = m.clients.filter((c) => chosen.includes(c.id));
      this.report(
        `${source.name} now applies to ${allClients ? "every client" : clientList(names)}.`,
        failures,
      );
    });
  };

  /**
   * Changes which clients get a template. Copies in clients that no longer get
   * it can go to their trash, or stay as those clients' own templates.
   */
  protected async changeClients(row: TemplateRow) {
    const template = this.templates().templates.find((t) => t.templateId === row.templateId);
    const m = this.msp();
    if (template == null) {
      return;
    }
    const name = row.name ?? "this template";
    const choice = await firstValueFrom(
      KeykeeperTemplateClientsDialogComponent.open(this.dialogService, {
        name,
        clients: m.clients.map(({ id, name }) => ({ id, name })),
        allClients: template.allClients,
        chosen: template.clients,
      }).closed,
    );
    if (choice == null) {
      return;
    }
    const targets = choice.allClients ? m.clients.map((c) => c.id) : choice.clients;
    const dropped = this.templates()
      .copies.filter((c) => c.templateId === row.templateId && !targets.includes(c.organizationId))
      .map((c) => c.cipherId)
      .filter((id) => this.items().some((i) => i.id === id && !i.isDeleted));
    const removeCopies =
      dropped.length > 0 &&
      (await this.dialogService.openSimpleDialog({
        title: "Remove it from the clients that no longer get it?",
        content: `${dropped.length === 1 ? "1 of them has" : dropped.length + " of them have"} it. Removing moves it to the client's trash; keeping leaves it as that client's own template.`,
        acceptButtonText: "Remove from those clients",
        cancelButtonText: "Keep it there",
        type: "warning",
      }));
    await this.attempt(async () => {
      await this.mspApi.setTemplate(m.id, row.templateId, {
        sourceCipherId: row.sourceCipherId,
        allClients: choice.allClients,
        clients: choice.clients,
      });
      if (removeCopies) {
        await this.sender.removeCopies(dropped);
      }
      const names = m.clients.filter((c) => choice.clients.includes(c.id));
      this.report(
        `${name} now applies to ${choice.allClients ? "every client" : clientList(names)}.`,
        await this.work.run(true),
      );
    });
  }

  /** Tries again for clients that don't have the latest version. */
  protected async update(row: TemplateRow) {
    await this.attempt(async () => {
      this.report(`Updated ${row.name ?? "the template"}.`, await this.work.run(true));
    });
  }

  protected async remove(row: TemplateRow) {
    const name = row.name ?? "this template";
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Remove ${name}?`,
      content: "Clients you add later won't get it, and its copies won't change anymore.",
      acceptButtonText: "Remove",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    const copies = this.templates()
      .copies.filter((c) => c.templateId === row.templateId)
      .map((c) => c.cipherId)
      .filter((id) => this.items().some((i) => i.id === id && !i.isDeleted));
    const removeCopies =
      copies.length > 0 &&
      (await this.dialogService.openSimpleDialog({
        title: "Remove it from your clients too?",
        content: `${copies.length === 1 ? "1 client has" : copies.length + " clients have"} it. Removing moves it to the client's trash; keeping leaves it as that client's own template.`,
        acceptButtonText: "Remove from clients",
        cancelButtonText: "Keep it there",
        type: "warning",
      }));
    await this.attempt(async () => {
      if (removeCopies) {
        await this.sender.removeCopies(copies);
      }
      await this.mspApi.stopTemplate(this.msp().id, row.templateId);
      this.toast("success", `Removed ${name}`);
      this.changed.emit();
    });
  }

  private report(done: string, failures: string[]) {
    if (failures.length > 0) {
      this.toast("warning", `${done} Not yet: ${failures.join("; ")}`);
    } else {
      this.toast("success", done);
    }
    this.changed.emit();
  }

  private async attempt(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      const message =
        e instanceof ErrorResponse
          ? e.getSingleMessage()
          : e instanceof Error
            ? e.message
            : String(e);
      this.toast("error", message);
    }
  }

  private toast(variant: "success" | "warning" | "error", message: string) {
    this.toastService.showToast({ variant, message });
  }
}
