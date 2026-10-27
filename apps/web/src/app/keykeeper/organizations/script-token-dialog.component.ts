import { ChangeDetectionStrategy, Component, Inject, computed, signal } from "@angular/core";
import { FormBuilder, Validators } from "@angular/forms";

import { ScriptFields } from "@bitwarden/admin-console/common";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DIALOG_DATA, DialogRef, DialogService, ToastService } from "@bitwarden/components";
import { visibleCustomFields } from "@bitwarden/vault";

import { SharedModule } from "../../shared";

export type ScriptTokenDialogData = {
  /** The organization's items the person can see, to grant from. */
  items: CipherView[];
};

export type ScriptTokenDialogResult = {
  name: string;
  /** End of the chosen day, as an ISO date and time. */
  expiresAt: string;
  networks: string[];
  grants: { item: CipherView; spec: ScriptFields }[];
};

const DAY = 86_400_000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Keykeeper: a new script token's settings: a name, when it expires (required,
 * at most a year), the networks it may be used from, and the items it may
 * read with exactly which fields of each. See docs/script-access.md in the
 * meta repo.
 */
@Component({
  selector: "app-keykeeper-script-token-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <form
      [formGroup]="form"
      [bitSubmit]="submit"
      bit-dialog
      dialogSize="large"
      title="New script token"
    >
      <ng-container bitDialogContent>
        <bit-form-field>
          <bit-label>Name</bit-label>
          <input bitInput formControlName="name" maxlength="100" />
          <bit-hint>What the script does, like "Join domain".</bit-hint>
        </bit-form-field>
        <bit-form-field>
          <bit-label>Expires</bit-label>
          <input bitInput type="date" formControlName="expires" [min]="minDate" [max]="maxDate" />
          <bit-hint>At most a year from today. Make a new token before it expires.</bit-hint>
        </bit-form-field>
        <bit-form-field>
          <bit-label>Only from these networks (optional)</bit-label>
          <textarea bitInput rows="2" formControlName="networks"></textarea>
          <bit-hint
            >IP addresses or ranges, one per line, like 203.0.113.0/24. Empty means
            anywhere.</bit-hint
          >
        </bit-form-field>

        <h3 bitTypography="h5" class="tw-mt-4">What it can read</h3>
        <bit-form-field>
          <bit-label>Find an item</bit-label>
          <input
            bitInput
            type="search"
            [value]="search()"
            (input)="search.set($any($event.target).value)"
          />
        </bit-form-field>
        <ul class="tw-m-0 tw-list-none tw-p-0" data-testid="script-token-items">
          @for (item of shown(); track item.id) {
            @let spec = specs()[item.id];
            <li class="tw-border-0 tw-border-b tw-border-solid tw-border-secondary-300 tw-py-2">
              <bit-form-control [disableMargin]="spec == null">
                <input
                  type="checkbox"
                  bitCheckbox
                  [checked]="spec != null"
                  (change)="toggle(item, $any($event.target).checked)"
                />
                <bit-label>{{ item.name }}</bit-label>
              </bit-form-control>
              @if (spec != null) {
                <div
                  class="tw-ml-6 tw-flex tw-flex-wrap tw-gap-x-4"
                  [attr.aria-label]="'Fields of ' + item.name"
                >
                  @if (item.type === CipherType.Login) {
                    <bit-form-control disableMargin>
                      <input
                        type="checkbox"
                        bitCheckbox
                        [checked]="spec.username"
                        (change)="set(item, 'username', $any($event.target).checked)"
                      />
                      <bit-label>Username</bit-label>
                    </bit-form-control>
                    <bit-form-control disableMargin>
                      <input
                        type="checkbox"
                        bitCheckbox
                        [checked]="spec.password"
                        (change)="set(item, 'password', $any($event.target).checked)"
                      />
                      <bit-label>Password</bit-label>
                    </bit-form-control>
                    @if (item.login?.totp) {
                      <bit-form-control disableMargin>
                        <input
                          type="checkbox"
                          bitCheckbox
                          [checked]="spec.totp"
                          (change)="set(item, 'totp', $any($event.target).checked)"
                        />
                        <bit-label>One-time code</bit-label>
                      </bit-form-control>
                    }
                  }
                  @for (field of fieldNames(item); track field) {
                    <bit-form-control disableMargin>
                      <input
                        type="checkbox"
                        bitCheckbox
                        [checked]="spec.fields.includes(field)"
                        (change)="setField(item, field, $any($event.target).checked)"
                      />
                      <bit-label>{{ field }}</bit-label>
                    </bit-form-control>
                  }
                </div>
              }
            </li>
          } @empty {
            <li bitTypography="body2">No items here. A token reads this organization's items.</li>
          }
        </ul>
      </ng-container>
      <ng-container bitDialogFooter>
        <button bitButton bitFormButton buttonType="primary" type="submit">Make token</button>
        <button bitButton buttonType="secondary" type="button" bitDialogClose>Cancel</button>
      </ng-container>
    </form>
  `,
})
export class KeykeeperScriptTokenDialogComponent {
  protected readonly CipherType = CipherType;
  protected readonly minDate = isoDate(new Date(Date.now() + DAY));
  protected readonly maxDate = isoDate(new Date(Date.now() + 365 * DAY));
  protected readonly form = this.formBuilder.group({
    name: ["", [Validators.required, Validators.maxLength(100)]],
    expires: [isoDate(new Date(Date.now() + 90 * DAY)), Validators.required],
    networks: [""],
  });
  protected readonly search = signal("");
  /** The chosen items, by id, with what each grant copies. */
  protected readonly specs = signal<Record<string, ScriptFields>>({});

  protected readonly shown = computed(() => {
    const words = this.search().trim().toLowerCase();
    const items = this.data.items
      .filter((i) => i.type === CipherType.Login || i.type === CipherType.SecureNote)
      .sort((a, b) => a.name.localeCompare(b.name));
    return words ? items.filter((i) => i.name.toLowerCase().includes(words)) : items;
  });

  constructor(
    @Inject(DIALOG_DATA) private readonly data: ScriptTokenDialogData,
    private readonly dialogRef: DialogRef<ScriptTokenDialogResult>,
    private readonly formBuilder: FormBuilder,
    private readonly toastService: ToastService,
  ) {}

  protected fieldNames(item: CipherView): string[] {
    return visibleCustomFields(item.fields)
      .map((f) => f.name ?? "")
      .filter((name) => name !== "");
  }

  protected toggle(item: CipherView, on: boolean) {
    this.specs.update((specs) => {
      const next = { ...specs };
      if (on) {
        // A login's username and password to start; anything else is chosen.
        const login = item.type === CipherType.Login;
        next[item.id] = { username: login, password: login, totp: false, fields: [] };
      } else {
        delete next[item.id];
      }
      return next;
    });
  }

  protected set(item: CipherView, part: "username" | "password" | "totp", on: boolean) {
    this.specs.update((specs) => ({ ...specs, [item.id]: { ...specs[item.id], [part]: on } }));
  }

  protected setField(item: CipherView, field: string, on: boolean) {
    this.specs.update((specs) => {
      const fields = specs[item.id].fields.filter((f) => f !== field);
      return {
        ...specs,
        [item.id]: { ...specs[item.id], fields: on ? [...fields, field] : fields },
      };
    });
  }

  protected readonly submit = async () => {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const grants = Object.entries(this.specs())
      .map(([id, spec]) => ({ item: this.data.items.find((i) => i.id === id)!, spec }))
      .filter((g) => g.item != null);
    const empty = grants.find(
      (g) => !g.spec.username && !g.spec.password && !g.spec.totp && g.spec.fields.length === 0,
    );
    if (grants.length === 0) {
      this.toast("Choose at least one item.");
      return;
    }
    if (empty) {
      this.toast(`Choose what the token reads from ${empty.item.name}.`);
      return;
    }
    const { name, expires, networks } = this.form.getRawValue();
    await this.dialogRef.close({
      name: name!.trim(),
      expiresAt: new Date(`${expires}T23:59:59Z`).toISOString(),
      networks: (networks ?? "")
        .split(/\s+/)
        .map((n) => n.trim())
        .filter((n) => n !== ""),
      grants,
    });
  };

  private toast(message: string) {
    this.toastService.showToast({ variant: "error", message });
  }

  static open(dialogService: DialogService, data: ScriptTokenDialogData) {
    return dialogService.open<ScriptTokenDialogResult, ScriptTokenDialogData>(
      KeykeeperScriptTokenDialogComponent,
      { data },
    );
  }
}
