import { TestBed } from "@angular/core/testing";
import { firstValueFrom, of, toArray } from "rxjs";

import {
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { DialogService } from "@bitwarden/components";

import { WebVaultPremiumUpgradePromptService } from "./web-premium-upgrade-prompt.service";

describe("WebVaultPremiumUpgradePromptService", () => {
  let service: WebVaultPremiumUpgradePromptService;
  let dialogServiceMock: jest.Mocked<DialogService>;
  let billingAccountProfileServiceMock: jest.Mocked<BillingAccountProfileStateService>;
  let openNotice: jest.SpyInstance;

  beforeEach(() => {
    dialogServiceMock = {
      open: jest.fn(),
      openSimpleDialog: jest.fn(),
    } as unknown as jest.Mocked<DialogService>;

    billingAccountProfileServiceMock = {
      hasPremiumFromAnySource$: jest.fn().mockReturnValue(of(false)),
    } as unknown as jest.Mocked<BillingAccountProfileStateService>;

    openNotice = jest
      .spyOn(KeykeeperPlanNoticeDialogComponent, "open")
      .mockReturnValue(undefined as never);

    TestBed.configureTestingModule({
      providers: [
        WebVaultPremiumUpgradePromptService,
        { provide: DialogService, useValue: dialogServiceMock },
        {
          provide: AccountService,
          useValue: { activeAccount$: of({ id: "user-123" }) } as unknown as AccountService,
        },
        { provide: BillingAccountProfileStateService, useValue: billingAccountProfileServiceMock },
      ],
    });

    service = TestBed.inject(WebVaultPremiumUpgradePromptService);
  });

  afterEach(() => {
    openNotice.mockRestore();
  });

  it("says Premium includes it, with no purchase page", async () => {
    await service.promptForPremium();

    expect(openNotice).toHaveBeenCalledWith(dialogServiceMock, {
      sentence: KeykeeperPlanSentence.Premium,
    });
    expect(dialogServiceMock.openSimpleDialog).not.toHaveBeenCalled();
  });

  it("says the organization's plan doesn't include it, with no Billing page", async () => {
    await service.promptForPremium("test-org-id" as OrganizationId);

    expect(openNotice).toHaveBeenCalledWith(dialogServiceMock, {
      sentence: KeykeeperPlanSentence.OrganizationPlan,
    });
    expect(dialogServiceMock.openSimpleDialog).not.toHaveBeenCalled();
  });

  it("says nothing to someone who has Premium", async () => {
    billingAccountProfileServiceMock.hasPremiumFromAnySource$.mockReturnValue(of(true));

    await service.promptForPremium();

    expect(openNotice).not.toHaveBeenCalled();
  });

  it("never confirms an upgrade", async () => {
    await service.promptForPremium();

    await expect(firstValueFrom(service.upgradeConfirmed$.pipe(toArray()))).resolves.toEqual([]);
  });
});
