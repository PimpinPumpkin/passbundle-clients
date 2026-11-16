import { TestBed } from "@angular/core/testing";
import { of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { DialogService } from "@bitwarden/components";

import { KeykeeperPlanSentence } from "../../keykeeper/plan-notice";
import { KeykeeperPlanNoticeDialogComponent } from "../../keykeeper/plan-notice-dialog.component";

import { PremiumBadgeComponent } from "./premium-badge.component";

// Keykeeper: a badge beside something with a sentence of its own says that
// sentence (DESIGN.md, "Plans and billing").
describe("PremiumBadgeComponent", () => {
  const promptForPremium = jest.fn().mockResolvedValue(undefined);
  const dialogService = { open: jest.fn() };
  let openNotice: jest.SpyInstance;

  beforeEach(async () => {
    promptForPremium.mockClear();
    openNotice = jest
      .spyOn(KeykeeperPlanNoticeDialogComponent, "open")
      .mockReturnValue(undefined as never);
    await TestBed.configureTestingModule({
      imports: [PremiumBadgeComponent],
      providers: [
        { provide: PremiumUpgradePromptService, useValue: { promptForPremium } },
        { provide: DialogService, useValue: dialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "user-1" }) } },
        {
          provide: BillingAccountProfileStateService,
          useValue: { hasPremiumFromAnySource$: () => of(false) },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    openNotice.mockRestore();
  });

  async function press(sentence?: KeykeeperPlanSentence) {
    const fixture = TestBed.createComponent(PremiumBadgeComponent);
    if (sentence) {
      fixture.componentRef.setInput("sentence", sentence);
    }
    fixture.detectChanges();
    await fixture.componentInstance.promptForPremium(new MouseEvent("click"));
  }

  it("says its own sentence when it has one", async () => {
    await press(KeykeeperPlanSentence.AttachFiles);

    expect(openNotice).toHaveBeenCalledWith(dialogService, {
      sentence: KeykeeperPlanSentence.AttachFiles,
    });
    expect(promptForPremium).not.toHaveBeenCalled();
  });

  it("leaves the rest to the Premium prompt", async () => {
    await press();

    expect(promptForPremium).toHaveBeenCalled();
    expect(openNotice).not.toHaveBeenCalled();
  });
});
