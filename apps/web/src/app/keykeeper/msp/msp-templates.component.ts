import { TemplatePortal } from "@angular/cdk/portal";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
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
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  BulkActionComponent,
  BulkActionsBarComponent,
  DialogService,
  LayoutFooterService,
  ToastService,
} from "@bitwarden/components";
import {
  customTemplate,
  rangeBetween,
  runEach,
  splitByAllowed,
  templateDefinition,
} from "@bitwarden/vault";

import { SharedModule } from "../../shared";

import { KeykeeperMspApiService, MspDetails, MspTemplates } from "./msp-api.service";
import { clientList } from "./msp-policies";
import { KeykeeperMspWorkService, KeykeeperTemplateSenderService } from "./msp-work.service";
import { KeykeeperTemplateClientsDialogComponent } from "./template-clients-dialog.component";
import {
  commonTargets,
  copiesByTemplate,
  skippedTemplatesNotice,
  skippedTemplatesResult,
  templateCount,
} from "./template-selection";

/**
 * Keykeeper: the item templates an MSP's clients get. A template here applies
 * automatically to every client (including clients added later) or to chosen
 * ones; any MSP admin's web vault keeps the clients' copies current, so people
 * only edit the template itself. See DESIGN.md, "MSP templates".
 *
 * An MSP admin can select several templates and change their clients, update
 * them or remove them together (DESIGN.md, "Selecting several items"). The
 * links in each row are who may do what; the bar offers the same and no more.
 */
@Component({
  selector: "app-keykeeper-msp-templates",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, BulkActionsBarComponent, BulkActionComponent],
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
        <!-- The list takes the focus on a click, so Cmd/Ctrl+A and Escape work in it. -->
        <div
          data-keykeeper="select-list"
          tabindex="-1"
          [attr.data-keykeeper-selecting]="selectedRows().length > 0 ? '' : null"
          (keydown)="onKeydown($event)"
        >
          <bit-table>
            <ng-container header>
              <tr>
                @if (isAdmin()) {
                  <th bitCell class="tw-w-10">
                    <input
                      type="checkbox"
                      bitCheckbox
                      aria-label="Select all templates"
                      [disabled]="busy()"
                      [checked]="allSelected()"
                      (change)="toggleAll()"
                    />
                  </th>
                }
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
                  @if (isAdmin()) {
                    <td bitCell class="tw-w-10">
                      <input
                        type="checkbox"
                        bitCheckbox
                        [attr.aria-label]="'Select ' + name"
                        [disabled]="busy()"
                        [checked]="isSelected(row)"
                        (click)="shiftHeld.set($event.shiftKey)"
                        (change)="toggle(row, shiftHeld())"
                      />
                    </td>
                  }
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
        </div>
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
              Make a template first, in an organization your MSP's admins share (not a client): in
              your items, open one of its shared folders, then choose New, then From template, then
              Create template.
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
                >Your organizations' templates, never one in Personal or a client's.</bit-hint
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

    <!-- In the layout's footer, like the bar of the items list: inside the page it would
         scroll away with it. -->
    <ng-template #selectionBar>
      <bit-bulk-actions-bar
        [selectedCount]="selectedRows().length"
        [note]="note()"
        [busy]="busy()"
        (clear)="clearSelection()"
      >
        @if (canChangeClients()) {
          <bit-bulk-action
            [action]="changeClientsOfSelected"
            icon="bwi-business"
            label="Clients"
            [disabled]="busy()"
          />
        }
        @if (canUpdate()) {
          <bit-bulk-action
            [action]="updateSelected"
            icon="bwi-refresh"
            label="Update"
            [disabled]="busy()"
          />
        }
        <bit-bulk-action
          [action]="removeSelected"
          icon="bwi-trash"
          label="Remove"
          [disabled]="busy()"
        />
      </bit-bulk-actions-bar>
    </ng-template>
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

  /** The templates selected, by ID. A template that goes away drops out of `selectedRows`. */
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  /** The row whose checkbox was clicked last, where a Shift+click range starts. */
  private readonly rangeAnchor = signal<string | null>(null);
  /** Whether Shift was held for the click that is toggling a checkbox. */
  protected readonly shiftHeld = signal(false);
  /** How far an action on several templates is, one request per template. */
  private readonly progress = signal<{ done: number; total: number } | null>(null);
  private readonly working = signal(false);
  protected readonly busy = computed(() => this.working() || this.progress() != null);
  protected readonly note = computed(() => {
    const progress = this.progress();
    return progress == null ? "" : `${progress.done} of ${progress.total} done`;
  });

  private readonly selectionBar = viewChild.required<TemplateRef<unknown>>("selectionBar");

  protected readonly rows = computed(() =>
    templateRows(
      this.templates(),
      this.msp().clients.map(({ id, name }) => ({ id, name })),
      knownItems(this.items()),
    ),
  );

  protected readonly selectedRows = computed(() =>
    this.isAdmin() ? this.rows().filter((row) => this.selectedIds().has(row.templateId)) : [],
  );
  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.selectedRows().length === this.rows().length,
  );
  /** As the row's own links: Clients and Update need the template itself in sight. */
  protected readonly canChangeClients = computed(() =>
    this.selectedRows().some((row) => row.sourceVisible),
  );
  protected readonly canUpdate = computed(() =>
    this.selectedRows().some((row) => row.sourceVisible && row.behind.length > 0),
  );

  /** Templates an admin can add: their organizations', never their own vault's or a client's. */
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
    private readonly layoutFooter: LayoutFooterService,
    private readonly viewContainerRef: ViewContainerRef,
  ) {
    const destroyRef = inject(DestroyRef);
    let bar: TemplatePortal | null = null;
    afterNextRender(() => {
      bar = new TemplatePortal(this.selectionBar(), this.viewContainerRef);
      this.layoutFooter.attach(bar);
    });
    destroyRef.onDestroy(() => {
      if (bar != null) {
        this.layoutFooter.detach(bar);
      }
    });
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
    this.work.updated$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.changed.emit());
  }

  protected isSelected(row: TemplateRow) {
    return this.selectedIds().has(row.templateId);
  }

  /** A row's checkbox. With Shift held, every row from the last one clicked to this one follows it. */
  protected toggle(row: TemplateRow, shiftKey: boolean) {
    const select = !this.selectedIds().has(row.templateId);
    const anchor = this.rangeAnchor();
    this.rangeAnchor.set(row.templateId);
    const order = this.rows().map((r) => r.templateId);
    const range =
      shiftKey && anchor != null ? rangeBetween(order, anchor, row.templateId) : [row.templateId];
    const ids = new Set(this.selectedIds());
    for (const id of range) {
      if (select) {
        ids.add(id);
      } else {
        ids.delete(id);
      }
    }
    this.selectedIds.set(ids);
  }

  protected toggleAll() {
    if (this.allSelected()) {
      this.clearSelection();
    } else {
      this.selectedIds.set(new Set(this.rows().map((row) => row.templateId)));
    }
  }

  protected clearSelection() {
    this.selectedIds.set(new Set());
    this.rangeAnchor.set(null);
  }

  /** Cmd/Ctrl+A selects every template, and Escape lets go of the selection. */
  protected onKeydown(event: KeyboardEvent) {
    if (!this.isAdmin() || this.busy()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (
      target?.isContentEditable ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (tag === "INPUT" && (target as HTMLInputElement).type !== "checkbox")
    ) {
      return;
    }
    if (
      event.key.toLowerCase() === "a" &&
      event.metaKey !== event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      this.selectedIds.set(new Set(this.rows().map((row) => row.templateId)));
      return;
    }
    if (event.key === "Escape" && this.selectedRows().length > 0) {
      event.preventDefault();
      event.stopPropagation();
      this.clearSelection();
    }
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
  protected async changeClients(row: TemplateRow): Promise<boolean> {
    const template = this.templates().templates.find((t) => t.templateId === row.templateId);
    const m = this.msp();
    if (template == null) {
      return false;
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
      return false;
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
        await this.sender.removeCopies(dropped, await this.mspApi.trustedClientIds(m.id));
      }
      const names = m.clients.filter((c) => choice.clients.includes(c.id));
      this.report(
        `${name} now applies to ${choice.allClients ? "every client" : clientList(names)}.`,
        await this.work.run(true),
      );
    });
    return true;
  }

  /**
   * The same for every selected template the person can see: one choice of
   * clients, one question about the copies left behind, then one request per
   * template. The ones the person can't see are counted before and after.
   */
  protected readonly changeClientsOfSelected = async () => {
    const selected = this.selectedRows();
    const plan = splitByAllowed(
      selected,
      selected.map((row) => row.sourceVisible),
    );
    if (plan.allowed.length === 0) {
      return;
    }
    if (selected.length === 1) {
      if (await this.changeClients(selected[0])) {
        this.clearSelection();
      }
      return;
    }
    const m = this.msp();
    const state = this.templates();
    const ids = plan.allowed.map((row) => row.templateId);
    const start = commonTargets(state.templates.filter((t) => ids.includes(t.templateId)));
    const choice = await firstValueFrom(
      KeykeeperTemplateClientsDialogComponent.open(this.dialogService, {
        name:
          plan.allowed.length === 1
            ? (plan.allowed[0].name ?? "this template")
            : templateCount(plan.allowed.length),
        clients: m.clients.map(({ id, name }) => ({ id, name })),
        allClients: start.allClients,
        chosen: start.chosen,
        notice: skippedTemplatesNotice(plan.skipped.length, selected.length),
      }).closed,
    );
    if (choice == null) {
      return;
    }
    const targets = choice.allClients ? m.clients.map((c) => c.id) : choice.clients;
    const dropped = copiesByTemplate(state.copies, ids, this.copyInSight, targets);
    const count = [...dropped.values()].flat().length;
    const removeCopies =
      count > 0 &&
      (await this.dialogService.openSimpleDialog({
        title: "Remove them from the clients that no longer get them?",
        content: `${count === 1 ? "1 copy is" : count + " copies are"} in clients that no longer get these templates. Removing moves a copy to the client's trash; keeping leaves it as that client's own template.`,
        acceptButtonText: "Remove from those clients",
        cancelButtonText: "Keep them there",
        type: "warning",
      }));
    await this.several(async () => {
      const run = await runEach(
        plan.allowed,
        (row) =>
          this.mspApi.setTemplate(m.id, row.templateId, {
            sourceCipherId: row.sourceCipherId,
            allClients: choice.allClients,
            clients: choice.clients,
          }),
        (done, total) => this.progress.set({ done, total }),
      );
      // Only where the change went through: a template that kept its clients keeps its copies.
      const gone = run.done.flatMap((row) => dropped.get(row.templateId) ?? []);
      if (removeCopies && gone.length > 0) {
        await this.sender.removeCopies(gone, await this.mspApi.trustedClientIds(m.id));
      }
      const names = m.clients.filter((c) => choice.clients.includes(c.id));
      const where = choice.allClients ? "every client" : clientList(names);
      const done =
        run.done.length === 0
          ? ""
          : `${templateCount(run.done.length)} now ${run.done.length === 1 ? "applies" : "apply"} to ${where}.`;
      const failed =
        run.failed.length === 0
          ? ""
          : ` ${templateCount(run.failed.length)} couldn't be changed. Try again.`;
      this.report(
        (done + failed + skippedTemplatesResult(plan.skipped.length)).trim(),
        await this.work.run(true),
        run.failed.length > 0 || plan.skipped.length > 0,
      );
    });
  };

  /** Tries again for clients that don't have the latest version. */
  protected async update(row: TemplateRow) {
    await this.attempt(async () => {
      const failures = await this.work.run(true);
      this.report(
        failures.length > 0
          ? `${row.name ?? "This template"} isn't up to date everywhere yet.`
          : `Updated ${row.name ?? "the template"}.`,
        failures,
      );
    });
  }

  /** The same for the selected templates that are behind: one pass covers them all. */
  protected readonly updateSelected = async () => {
    const behind = this.selectedRows().filter((row) => row.sourceVisible && row.behind.length > 0);
    if (behind.length === 0) {
      return;
    }
    if (behind.length === 1) {
      await this.several(() => this.update(behind[0]));
      return;
    }
    await this.several(async () => {
      const failures = await this.work.run(true);
      this.report(
        failures.length > 0
          ? "These templates aren't up to date everywhere yet."
          : `Updated ${templateCount(behind.length)}.`,
        failures,
      );
    });
  };

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
        await this.sender.removeCopies(copies, await this.mspApi.trustedClientIds(this.msp().id));
      }
      await this.mspApi.stopTemplate(this.msp().id, row.templateId);
      this.toast("success", `Removed ${name}`);
      this.changed.emit();
    });
  }

  /**
   * Removes every selected template: one confirmation that says how many, one
   * question about the clients' copies, then one template after the other.
   */
  protected readonly removeSelected = async () => {
    const selected = this.selectedRows();
    if (selected.length === 0) {
      return;
    }
    if (selected.length === 1) {
      await this.remove(selected[0]);
      return;
    }
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Remove ${selected.length} templates?`,
      content: "Clients you add later won't get them, and their copies won't change anymore.",
      acceptButtonText: "Remove",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    const copies = copiesByTemplate(
      this.templates().copies,
      selected.map((row) => row.templateId),
      this.copyInSight,
    );
    const count = [...copies.values()].flat().length;
    const removeCopies =
      count > 0 &&
      (await this.dialogService.openSimpleDialog({
        title: "Remove them from your clients too?",
        content: `Your clients have ${count === 1 ? "1 copy" : count + " copies"} of them. Removing moves a copy to the client's trash; keeping leaves it as that client's own template.`,
        acceptButtonText: "Remove from clients",
        cancelButtonText: "Keep them there",
        type: "warning",
      }));
    await this.several(async () => {
      const mspId = this.msp().id;
      const trusted = removeCopies ? await this.mspApi.trustedClientIds(mspId) : null;
      const run = await runEach(
        selected,
        async (row) => {
          const own = copies.get(row.templateId) ?? [];
          if (trusted != null && own.length > 0) {
            await this.sender.removeCopies(own, trusted);
          }
          await this.mspApi.stopTemplate(mspId, row.templateId);
        },
        (done, total) => this.progress.set({ done, total }),
      );
      if (run.failed.length === 0) {
        this.toast("success", `Removed ${templateCount(run.done.length)}`);
      } else if (run.done.length === 0) {
        this.toast("error", `${templateCount(run.failed.length)} couldn't be removed. Try again.`);
      } else {
        this.toast(
          "warning",
          `Removed ${templateCount(run.done.length)}. ${templateCount(run.failed.length)} couldn't be removed. Try again.`,
        );
      }
      this.changed.emit();
    });
  };

  /** A client's copy the person can see and that isn't in the trash already. */
  private readonly copyInSight = (cipherId: string) =>
    this.items().some((i) => i.id === cipherId && !i.isDeleted);

  /** An action on the selection: the bar is busy while it runs and lets go of the selection after. */
  private async several(action: () => Promise<void>) {
    this.working.set(true);
    try {
      await action();
    } catch (e) {
      this.toast("error", plainErrorMessage(e));
      // Some of it may have gone through, so show the templates as they are now.
      this.changed.emit();
    } finally {
      this.working.set(false);
      this.progress.set(null);
      this.clearSelection();
    }
  }

  /**
   * What was done, then what didn't work yet, each in its own words, and what to do about it.
   * `incomplete` when `done` itself says that some of it was skipped or refused.
   */
  private report(done: string, failures: string[], incomplete = false) {
    if (failures.length > 0) {
      const list = failures.map((f) => f.trim().replace(/\.+$/, "")).join("; ");
      this.toast(
        "warning",
        `${done} Some of it didn't work yet: ${list}. Use Update to try again.`,
      );
    } else {
      this.toast(incomplete ? "warning" : "success", done);
    }
    this.changed.emit();
  }

  private async attempt(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      const message = plainErrorMessage(e);
      this.toast("error", message);
    }
  }

  private toast(variant: "success" | "warning" | "error", message: string) {
    this.toastService.showToast({ variant, message });
  }
}
