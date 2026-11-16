import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import {
  ButtonModule,
  CenterPositionStrategy,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { KeykeeperPlanSentence } from "./plan-notice";
import { KeykeeperPlanNoticeComponent } from "./plan-notice.component";

export type KeykeeperPlanNoticeDialogData = {
  sentence: KeykeeperPlanSentence;
};

/**
 * Keykeeper: the plan notice as a small window, for a button or a page that
 * the plan doesn't include. It says the sentence and closes; it never takes
 * anyone to another page.
 */
@Component({
  selector: "billing-keykeeper-plan-notice-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, DialogModule, I18nPipe, KeykeeperPlanNoticeComponent],
  template: `
    <bit-simple-dialog hideIcon data-testid="keykeeper-plan-notice-dialog">
      <span bitDialogTitle>{{ title | i18n }}</span>
      <div bitDialogContent>
        <billing-keykeeper-plan-notice [sentence]="data.sentence" />
      </div>
      <ng-container bitDialogFooter>
        <button type="button" bitButton buttonType="primary" bitDialogClose>
          {{ "close" | i18n }}
        </button>
      </ng-container>
    </bit-simple-dialog>
  `,
})
export class KeykeeperPlanNoticeDialogComponent {
  protected readonly data = inject<KeykeeperPlanNoticeDialogData>(DIALOG_DATA);

  protected readonly title =
    this.data.sentence === KeykeeperPlanSentence.OrganizationEnded
      ? "keykeeperPlanEndedTitle"
      : "keykeeperPlanPremiumTitle";

  static open(
    dialogService: DialogService,
    data: KeykeeperPlanNoticeDialogData,
  ): DialogRef<unknown> {
    return dialogService.open(KeykeeperPlanNoticeDialogComponent, {
      data,
      positionStrategy: new CenterPositionStrategy(),
    });
  }
}
