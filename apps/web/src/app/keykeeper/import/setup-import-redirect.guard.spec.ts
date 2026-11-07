import { TestBed } from "@angular/core/testing";
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from "@angular/router";
import { BehaviorSubject, throwError } from "rxjs";

import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { Account, AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";

import { SETUP_IMPORT, setupImportRedirectGuard } from "./setup-import-redirect.guard";

describe("setupImportRedirectGuard", () => {
  const route = Object.freeze({ queryParams: {} }) as ActivatedRouteSnapshot;
  const state = Object.freeze({}) as RouterStateSnapshot;
  const activeAccount$ = new BehaviorSubject<Account | null>({
    id: "account-id",
  } as unknown as Account);
  const createUrlTree = jest.fn((commands: string[]) => commands.join("/"));
  let ciphers$: jest.Mock;
  let policyApplies$: jest.Mock;

  beforeEach(() => {
    Utils.isMobileBrowser = false;
    sessionStorage.clear();
    createUrlTree.mockClear();
    ciphers$ = jest.fn(() => new BehaviorSubject({}));
    policyApplies$ = jest.fn(() => new BehaviorSubject(false));
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { createUrlTree } },
        { provide: AccountService, useValue: { activeAccount$ } },
        { provide: CipherService, useValue: { ciphers$: (id: string) => ciphers$(id) } },
        {
          provide: PolicyService,
          useValue: {
            policyAppliesToUser$: (type: PolicyType, id: string) => policyApplies$(type, id),
          },
        },
      ],
    });
  });

  function guard() {
    return TestBed.runInInjectionContext(async () => setupImportRedirectGuard(route, state));
  }

  it("lets the vault open when nobody has just signed up", async () => {
    expect(await guard()).toBe(true);
    expect(ciphers$).not.toHaveBeenCalled();
  });

  it("offers the import step once, right after signing up, to an empty vault", async () => {
    sessionStorage.setItem(SETUP_IMPORT, "1");

    expect(await guard()).toBe("/setup-import");
    expect(ciphers$).toHaveBeenCalledWith("account-id");
    // Still set: the step clears it when it's done or skipped.
    expect(sessionStorage.getItem(SETUP_IMPORT)).toBe("1");
  });

  it("skips it, and forgets it, when the vault already has items", async () => {
    sessionStorage.setItem(SETUP_IMPORT, "1");
    ciphers$.mockReturnValue(new BehaviorSubject({ "cipher-id": {} }));

    expect(await guard()).toBe(true);
    expect(sessionStorage.getItem(SETUP_IMPORT)).toBeNull();
  });

  it("skips it, and forgets it, where an organization keeps items out of Personal", async () => {
    sessionStorage.setItem(SETUP_IMPORT, "1");
    policyApplies$.mockReturnValue(new BehaviorSubject(true));

    expect(await guard()).toBe(true);
    expect(policyApplies$).toHaveBeenCalledWith(PolicyType.OrganizationDataOwnership, "account-id");
    expect(sessionStorage.getItem(SETUP_IMPORT)).toBeNull();
  });

  it("skips it on a phone's browser", async () => {
    sessionStorage.setItem(SETUP_IMPORT, "1");
    Utils.isMobileBrowser = true;

    expect(await guard()).toBe(true);
    expect(sessionStorage.getItem(SETUP_IMPORT)).toBeNull();
  });

  it("opens the vault when the items can't be read", async () => {
    sessionStorage.setItem(SETUP_IMPORT, "1");
    ciphers$.mockReturnValue(throwError(() => new Error("locked")));

    expect(await guard()).toBe(true);
    expect(sessionStorage.getItem(SETUP_IMPORT)).toBeNull();
  });
});
