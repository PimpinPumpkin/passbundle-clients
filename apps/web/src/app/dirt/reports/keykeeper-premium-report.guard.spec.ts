import { TestBed } from "@angular/core/testing";
import { Router, UrlTree } from "@angular/router";
import { BehaviorSubject } from "rxjs";

import {
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { DialogService } from "@bitwarden/components";

import { keykeeperPremiumReportGuard } from "./keykeeper-premium-report.guard";

describe("keykeeperPremiumReportGuard", () => {
  const hasPremium$ = new BehaviorSubject<boolean>(false);
  const reportsTree = { toString: () => "/reports" } as UrlTree;
  const createUrlTree = jest.fn().mockReturnValue(reportsTree);
  const dialogService = { open: jest.fn() };
  let openNotice: jest.SpyInstance;
  let activeAccount$: BehaviorSubject<{ id: string } | null>;

  beforeEach(() => {
    hasPremium$.next(false);
    createUrlTree.mockClear();
    activeAccount$ = new BehaviorSubject<{ id: string } | null>({ id: "user-1" });
    openNotice = jest
      .spyOn(KeykeeperPlanNoticeDialogComponent, "open")
      .mockReturnValue(undefined as never);

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { createUrlTree } },
        { provide: DialogService, useValue: dialogService },
        { provide: AccountService, useValue: { activeAccount$ } },
        {
          provide: BillingAccountProfileStateService,
          useValue: { hasPremiumFromAnySource$: jest.fn(() => hasPremium$) },
        },
      ],
    });
  });

  afterEach(() => {
    openNotice.mockRestore();
  });

  function run(sentence?: KeykeeperPlanSentence) {
    return TestBed.runInInjectionContext(() =>
      keykeeperPremiumReportGuard(sentence)(null as never, null as never),
    );
  }

  it("lets someone with Premium in", async () => {
    hasPremium$.next(true);

    await expect(run(KeykeeperPlanSentence.BreachReport)).resolves.toBe(true);
    expect(openNotice).not.toHaveBeenCalled();
  });

  it("says the data breach report is part of Premium and stays on the reports", async () => {
    const result = await run(KeykeeperPlanSentence.BreachReport);

    expect(result).toBe(reportsTree);
    expect(createUrlTree).toHaveBeenCalledWith(["/reports"]);
    expect(openNotice).toHaveBeenCalledWith(dialogService, {
      sentence: KeykeeperPlanSentence.BreachReport,
    });
  });

  it("says the general sentence when the report has none of its own", async () => {
    await run();

    expect(openNotice).toHaveBeenCalledWith(dialogService, {
      sentence: KeykeeperPlanSentence.Premium,
    });
  });

  it("keeps the report closed when nobody is signed in", async () => {
    activeAccount$.next(null);

    await expect(run(KeykeeperPlanSentence.BreachReport)).resolves.toBe(reportsTree);
  });
});
