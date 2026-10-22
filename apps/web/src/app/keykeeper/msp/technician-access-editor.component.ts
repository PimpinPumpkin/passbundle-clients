import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  output,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, FormControl } from "@angular/forms";

import { SharedModule } from "../../shared";

import { CustomPermissions, TechnicianAccess } from "./msp-api.service";
import { DEFAULT_ACCESS, NO_PERMISSIONS, PERMISSIONS } from "./technician-access";

/**
 * Keykeeper: what an MSP technician gets in the MSP's clients. Every client or
 * chosen ones, admin or a custom role inside them (with or without vault
 * items), a different role in some of those clients, and whether they see
 * install commands. Emits the access on every change, starting from the one
 * it was given; the parent saves it.
 */
@Component({
  selector: "app-keykeeper-technician-access",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <div [formGroup]="form" class="tw-flex tw-flex-col tw-gap-2">
      <bit-radio-group formControlName="scope" [block]="true">
        <bit-label>Clients</bit-label>
        <bit-radio-button value="all">
          <bit-label>Every client</bit-label>
          <bit-hint>Including clients added later.</bit-hint>
        </bit-radio-button>
        <bit-radio-button value="chosen">
          <bit-label>Only the clients chosen here</bit-label>
        </bit-radio-button>
      </bit-radio-group>
      @if (form.controls.scope.value === "chosen") {
        <div class="tw-mb-2 tw-ml-6" formGroupName="clients">
          @for (client of clients(); track client.id) {
            <bit-form-control>
              <input type="checkbox" bitCheckbox [formControlName]="client.id" />
              <bit-label>{{ client.name }}</bit-label>
            </bit-form-control>
          } @empty {
            <p bitTypography="helper">No clients yet.</p>
          }
        </div>
      }

      <bit-radio-group formControlName="role" [block]="true">
        <bit-label>Role in those clients</bit-label>
        <bit-radio-button value="admin">
          <bit-label>Admin</bit-label>
          <bit-hint>Manages everything in the client and sees every vault item.</bit-hint>
        </bit-radio-button>
        <bit-radio-button value="custom">
          <bit-label>Custom</bit-label>
          <bit-hint>Only the permissions chosen here, and only for regular members.</bit-hint>
        </bit-radio-button>
      </bit-radio-group>
      @if (form.controls.role.value === "custom") {
        <div class="tw-mb-2 tw-ml-6">
          <div formGroupName="permissions">
            @for (p of permissions; track p.key) {
              <bit-form-control>
                <input type="checkbox" bitCheckbox [formControlName]="p.key" />
                <bit-label>{{ p.label | i18n }}</bit-label>
              </bit-form-control>
            }
          </div>
          <bit-form-control>
            <input type="checkbox" bitCheckbox formControlName="vaultItems" />
            <bit-label>Sees and edits every vault item</bit-label>
            <bit-hint>
              In their own vault. Otherwise they see only collections the client shares with them.
            </bit-hint>
          </bit-form-control>
        </div>
      }

      <div formArrayName="clientRoles" class="tw-mb-2">
        <p class="tw-mb-1 tw-font-semibold">A different role in some clients</p>
        @for (row of form.controls.clientRoles.controls; track row; let i = $index) {
          <div [formGroupName]="i" class="tw-mb-2 tw-ml-6" data-testid="client-role">
            <div class="tw-flex tw-items-end tw-gap-2">
              <bit-form-field class="tw-mb-0 tw-grow">
                <bit-label>Client</bit-label>
                <select bitInput formControlName="client">
                  @for (client of reachedClients(); track client.id) {
                    <option [value]="client.id">{{ client.name }}</option>
                  }
                </select>
              </bit-form-field>
              <bit-form-field class="tw-mb-0">
                <bit-label>Role there</bit-label>
                <select bitInput formControlName="role">
                  <option value="admin">Admin</option>
                  <option value="custom">Custom</option>
                </select>
              </bit-form-field>
              <button
                type="button"
                bitIconButton="bwi-trash"
                buttonType="danger"
                label="Remove this client's role"
                (click)="removeClientRole(i)"
              ></button>
            </div>
            @if (row.controls.role.value === "custom") {
              <div class="tw-ml-6 tw-mt-1">
                <div formGroupName="permissions">
                  @for (p of permissions; track p.key) {
                    <bit-form-control>
                      <input type="checkbox" bitCheckbox [formControlName]="p.key" />
                      <bit-label>{{ p.label | i18n }}</bit-label>
                    </bit-form-control>
                  }
                </div>
                <bit-form-control>
                  <input type="checkbox" bitCheckbox formControlName="vaultItems" />
                  <bit-label>Sees and edits every vault item</bit-label>
                </bit-form-control>
              </div>
            }
          </div>
        }
        @if (reachedClients().length > form.controls.clientRoles.length) {
          <button type="button" bitButton buttonType="secondary" (click)="addClientRole()">
            Add a client with a different role
          </button>
        }
      </div>

      <bit-form-control>
        <input type="checkbox" bitCheckbox formControlName="installCommands" />
        <bit-label>Sees install commands</bit-label>
        <bit-hint>
          The RMM install command of each client they reach. Anyone who has one can ask to join.
        </bit-hint>
      </bit-form-control>
    </div>
  `,
})
export class KeykeeperTechnicianAccessEditorComponent implements OnInit {
  /** The MSP's clients to choose from. */
  readonly clients = input.required<{ id: string; name: string }[]>();
  /** The access to start from. */
  readonly access = input<TechnicianAccess>(DEFAULT_ACCESS);
  readonly accessChange = output<TechnicianAccess>();

  protected readonly permissions = PERMISSIONS;
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changes = inject(ChangeDetectorRef);

  protected readonly form = this.formBuilder.nonNullable.group({
    scope: ["all" as "all" | "chosen"],
    clients: this.formBuilder.nonNullable.record<boolean>({}),
    role: ["admin" as "admin" | "custom"],
    permissions: this.formBuilder.nonNullable.group({ ...NO_PERMISSIONS }),
    vaultItems: [false],
    installCommands: [true],
    clientRoles: this.formBuilder.nonNullable.array([this.clientRoleGroup()]),
  });

  /** One client's different role. */
  private clientRoleGroup(
    client = "",
    custom: { permissions: Partial<CustomPermissions>; vaultItems: boolean } | null = null,
  ) {
    return this.formBuilder.nonNullable.group({
      client: [client],
      role: [custom == null ? "admin" : "custom"] as ["admin" | "custom"],
      permissions: this.formBuilder.nonNullable.group({
        ...NO_PERMISSIONS,
        ...(custom?.permissions ?? {}),
      }),
      vaultItems: [custom?.vaultItems ?? false],
    });
  }

  /** The clients they reach, which can have a different role. */
  protected reachedClients(): { id: string; name: string }[] {
    const v = this.form.getRawValue();
    return v.scope === "all" ? this.clients() : this.clients().filter((c) => v.clients[c.id]);
  }

  protected addClientRole() {
    const taken = new Set(this.form.getRawValue().clientRoles.map((r) => r.client));
    const next = this.reachedClients().find((c) => !taken.has(c.id));
    if (next) {
      this.form.controls.clientRoles.push(this.clientRoleGroup(next.id));
      this.changes.markForCheck();
    }
  }

  protected removeClientRole(index: number) {
    this.form.controls.clientRoles.removeAt(index);
    this.changes.markForCheck();
  }

  ngOnInit() {
    const access = this.access();
    for (const client of this.clients()) {
      this.form.controls.clients.addControl(
        client.id,
        new FormControl(access.clients.includes(client.id), { nonNullable: true }),
      );
    }
    this.form.controls.clientRoles.clear();
    for (const role of access.clientRoles ?? []) {
      this.form.controls.clientRoles.push(this.clientRoleGroup(role.client, role.custom));
    }
    this.form.patchValue({
      scope: access.allClients ? "all" : "chosen",
      role: access.custom == null ? "admin" : "custom",
      permissions: access.custom?.permissions ?? NO_PERMISSIONS,
      vaultItems: access.custom?.vaultItems ?? false,
      installCommands: access.installCommands,
    });
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.accessChange.emit(this.value()));
  }

  private value(): TechnicianAccess {
    const v = this.form.getRawValue();
    const allClients = v.scope === "all";
    const reached = new Set(this.reachedClients().map((c) => c.id));
    const seen = new Set<string>();
    return {
      allClients,
      clients: allClients
        ? []
        : Object.entries(v.clients)
            .filter(([, chosen]) => chosen)
            .map(([id]) => id),
      custom:
        v.role === "custom"
          ? { permissions: { ...NO_PERMISSIONS, ...v.permissions }, vaultItems: v.vaultItems }
          : null,
      installCommands: v.installCommands,
      // Only clients they still reach, each once (the first row wins).
      clientRoles: v.clientRoles
        .filter((r) => reached.has(r.client) && !seen.has(r.client) && seen.add(r.client))
        .map((r) => ({
          client: r.client,
          custom:
            r.role === "custom"
              ? { permissions: { ...NO_PERMISSIONS, ...r.permissions }, vaultItems: r.vaultItems }
              : null,
        })),
    };
  }
}
