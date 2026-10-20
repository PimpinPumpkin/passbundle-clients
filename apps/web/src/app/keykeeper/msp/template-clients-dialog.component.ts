import { ChangeDetectionStrategy, Component, Inject } from "@angular/core";
import { FormBuilder, FormControl, FormGroup } from "@angular/forms";

import { DIALOG_DATA, DialogRef, DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

export type TemplateClientsDialogData = {
  /** The template's name. */
  name: string;
  clients: { id: string; name: string }[];
  allClients: boolean;
  /** The clients it goes to now, when not every client. */
  chosen: string[];
};

export type TemplateClientsDialogResult = { allClients: boolean; clients: string[] };

/**
 * Keykeeper: which of an MSP's clients get a template, changed in place
 * instead of removing the template and adding it again. Saving returns the
 * choice; the caller sends it and says what happens to existing copies. See
 * DESIGN.md, "MSP templates".
 */
@Component({
  selector: "app-keykeeper-template-clients-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <form
      [formGroup]="form"
      [bitSubmit]="submit"
      bit-dialog
      title="Applies to"
      [subtitle]="data.name"
    >
      <ng-container bitDialogContent>
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
          <div class="tw-ml-6" [formGroup]="chosen">
            @for (client of data.clients; track client.id) {
              <bit-form-control>
                <input type="checkbox" bitCheckbox [formControlName]="client.id" />
                <bit-label>{{ client.name }}</bit-label>
              </bit-form-control>
            }
          </div>
        }
      </ng-container>
      <ng-container bitDialogFooter>
        <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
        <button bitButton buttonType="secondary" type="button" bitDialogClose>Cancel</button>
      </ng-container>
    </form>
  `,
})
export class KeykeeperTemplateClientsDialogComponent {
  protected readonly form = this.formBuilder.group({
    scope: [(this.data.allClients ? "all" : "chosen") as "all" | "chosen"],
  });
  protected readonly chosen = new FormGroup<Record<string, FormControl<boolean | null>>>(
    Object.fromEntries(
      this.data.clients.map((c) => [
        c.id,
        new FormControl<boolean | null>(!this.data.allClients && this.data.chosen.includes(c.id)),
      ]),
    ),
  );

  constructor(
    @Inject(DIALOG_DATA) protected readonly data: TemplateClientsDialogData,
    private readonly dialogRef: DialogRef<TemplateClientsDialogResult>,
    private readonly formBuilder: FormBuilder,
    private readonly toastService: ToastService,
  ) {}

  protected readonly submit = async () => {
    const allClients = this.form.controls.scope.value === "all";
    const clients = allClients
      ? []
      : Object.entries(this.chosen.value)
          .filter(([, on]) => on)
          .map(([id]) => id);
    if (!allClients && clients.length === 0) {
      this.toastService.showToast({ variant: "error", message: "Choose at least one client." });
      return;
    }
    await this.dialogRef.close({ allClients, clients });
  };

  static open(dialogService: DialogService, data: TemplateClientsDialogData) {
    return dialogService.open<TemplateClientsDialogResult, TemplateClientsDialogData>(
      KeykeeperTemplateClientsDialogComponent,
      { data },
    );
  }
}
