import { TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";

import {
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { DialogService } from "@bitwarden/components";

import { BrowserPremiumUpgradePromptService } from "./browser-premium-upgrade-prompt.service";

describe("BrowserPremiumUpgradePromptService", () => {
  let service: BrowserPremiumUpgradePromptService;
  let dialogService: MockProxy<DialogService>;

  beforeEach(async () => {
    dialogService = mock<DialogService>();

    await TestBed.configureTestingModule({
      providers: [
        BrowserPremiumUpgradePromptService,
        { provide: DialogService, useValue: dialogService },
      ],
    }).compileComponents();

    service = TestBed.inject(BrowserPremiumUpgradePromptService);
  });

  describe("promptForPremium", () => {
    let openSpy: jest.SpyInstance;

    beforeEach(() => {
      openSpy = jest.spyOn(KeykeeperPlanNoticeDialogComponent, "open").mockImplementation();
    });

    afterEach(() => {
      openSpy.mockRestore();
    });

    it("says Premium includes it, with no purchase page", async () => {
      await service.promptForPremium();

      expect(openSpy).toHaveBeenCalledWith(dialogService, {
        sentence: KeykeeperPlanSentence.Premium,
      });
    });
  });
});
