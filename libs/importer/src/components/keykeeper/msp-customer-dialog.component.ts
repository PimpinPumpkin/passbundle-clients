import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormControl, ReactiveFormsModule } from "@angular/forms";

import {
  ButtonModule,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
  RadioButtonModule,
  TypographyModule,
} from "@bitwarden/components";

import { MspCustomer } from "../../importers/msp";

/** One customer's rows, by name as the file writes it ("" for the rows that name none), or all of them. */
export type MspCustomerChoice = { customer: string } | { all: true };

export type MspCustomerDialogData = {
  /** The organization the rows go into. */
  organizationName: string;
  /** What the export calls a customer: "client", "IT Glue organization". */
  customerWord: { one: string; many: string };
  customers: MspCustomer[];
};

/** The radio value for "All of them": no customer's name starts with a line feed, since names are trimmed. */
const ALL = "\nall";

/**
 * Keykeeper: an MSP's Passportal or IT Glue export holds every customer, and
 * each is its own organization in PassBundle, so importing one into an
 * organization asks whose rows go in: one customer at a time, with how many
 * rows each has, or all of them, each as its own shared folder
 * (msp-import.ts; DESIGN.md, "Importing from other password managers").
 */
@Component({
  selector: "tools-keykeeper-msp-customer-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, DialogModule, RadioButtonModule, ReactiveFormsModule, TypographyModule],
  template: `
    <bit-dialog>
      <span bitDialogTitle
        >Which {{ data.customerWord.one }} goes into {{ data.organizationName }}?</span
      >
      <div bitDialogContent>
        <p bitTypography="body1">
          This export has passwords for {{ named }}
          {{ named === 1 ? data.customerWord.one : data.customerWord.many }}. Each should be an
          organization of its own: import one here, and the others into their own organizations.
        </p>
        <bit-radio-group [formControl]="choice" [block]="true" data-testid="msp-customers">
          <bit-label>{{ capitalized(data.customerWord.one) }}</bit-label>
          @for (c of data.customers; track c.name) {
            <bit-radio-button [value]="c.name">
              <bit-label
                >{{ c.name || "No " + data.customerWord.one }}, {{ count(c.rows) }}</bit-label
              >
            </bit-radio-button>
          }
          <bit-radio-button [value]="all">
            <bit-label>All of them, {{ count(total) }}</bit-label>
            <bit-hint
              >Each {{ data.customerWord.one }} gets its own shared folder in
              {{ data.organizationName }}.</bit-hint
            >
          </bit-radio-button>
        </bit-radio-group>
      </div>
      <ng-container bitDialogFooter>
        <button
          bitButton
          buttonType="primary"
          type="button"
          [disabled]="chosen() == null"
          (click)="import()"
        >
          Import
        </button>
        <button bitButton buttonType="secondary" type="button" bitDialogClose>Cancel</button>
      </ng-container>
    </bit-dialog>
  `,
})
export class KeykeeperMspCustomerDialogComponent {
  protected readonly data = inject<MspCustomerDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject<DialogRef<MspCustomerChoice>>(DialogRef);

  protected readonly all = ALL;
  protected readonly choice = new FormControl<string | null>(null);
  /** The choice, as a signal, so the Import button follows it. */
  protected readonly chosen = toSignal(this.choice.valueChanges, { initialValue: null });
  protected readonly total = this.data.customers.reduce((sum, c) => sum + c.rows, 0);
  protected readonly named = this.data.customers.filter((c) => c.name !== "").length;

  protected count(rows: number): string {
    return `${rows} ${rows === 1 ? "password" : "passwords"}`;
  }

  protected capitalized(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  protected import() {
    const value = this.choice.value;
    if (value == null) {
      return;
    }
    void this.dialogRef.close(value === ALL ? { all: true } : { customer: value });
  }

  static open(dialogService: DialogService, data: MspCustomerDialogData) {
    return dialogService.open<MspCustomerChoice, MspCustomerDialogData>(
      KeykeeperMspCustomerDialogComponent,
      { data },
    );
  }
}
