import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, input, signal } from "@angular/core";

import { EventCollectionService, EventType } from "@bitwarden/common/dirt/event-logs";
import { HIDDEN_VALUE_MASK, mayShow } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { PassportView } from "@bitwarden/common/vault/models/view/passport.view";
import {
  SectionHeaderComponent,
  TypographyModule,
  FormFieldModule,
  IconButtonModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { CopyCipherFieldDirective } from "../../components/copy-cipher-field.directive";
import { ReadOnlyCipherCardComponent } from "../read-only-cipher-card/read-only-cipher-card.component";

@Component({
  selector: "app-passport-view",
  templateUrl: "passport-view.component.html",
  imports: [
    I18nPipe,
    CopyCipherFieldDirective,
    SectionHeaderComponent,
    ReadOnlyCipherCardComponent,
    TypographyModule,
    FormFieldModule,
    IconButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PassportViewComponent {
  /** Keykeeper: shown in place of a value the person can't see. */
  protected readonly mask = HIDDEN_VALUE_MASK;

  /**
   * Keykeeper: whether the person may see one of the item's values
   * (`part.property`): someone who can't see the item's passwords gets only
   * the plain ones (DESIGN.md, "Folders and permissions"), with a mask, and
   * nothing to show, copy, or drag, for the rest.
   */
  protected canSee(key: string): boolean {
    return mayShow(this.cipher(), key);
  }

  private readonly eventCollectionService = inject(EventCollectionService);
  private readonly datePipe = inject(DatePipe);

  readonly passport = input.required<PassportView>();
  readonly cipher = input.required<CipherView>();
  readonly revealPassportNumber = signal(false);
  readonly revealNationalIdentificationNumber = signal(false);

  async togglePassportNumberVisible(event: boolean) {
    this.revealPassportNumber.set(event);

    if (event) {
      await this.eventCollectionService.collect(
        EventType.Cipher_ClientToggledPassportNumberVisible,
        this.cipher().id,
        false,
        this.cipher().organizationId,
      );
    }
  }

  async toggleNationalIdentificationNumberVisible(event: boolean) {
    this.revealNationalIdentificationNumber.set(event);

    if (event) {
      await this.eventCollectionService.collect(
        EventType.Cipher_ClientToggledNationalIdentificationNumberVisible,
        this.cipher().id,
        false,
        this.cipher().organizationId,
      );
    }
  }

  formatDate(dateStr: string | undefined): string {
    if (!dateStr) {
      return "";
    }

    const [year, month, day] = dateStr.split("-");

    if (year && month && day) {
      const date = new Date(+year, +month - 1, +day);
      return this.datePipe.transform(date, "longDate") ?? dateStr;
    }

    if (year && month) {
      const date = new Date(+year, +month - 1, 1);
      return this.datePipe.transform(date, "MMMM y") ?? dateStr;
    }

    return year ?? dateStr;
  }
}
