import { TestBed } from "@angular/core/testing";
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from "@angular/router";

import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";

import { rememberSetUpMsp } from "./msp-setup";
import { setUpMspGuard, setUpMspRedirectGuard } from "./msp-setup.guard";

// Keykeeper: the website's way in for an MSP signing up by itself
// (DESIGN.md, "MSP console", "Getting there"): /#/set-up-msp, then sign-up or
// sign-in, then the MSP console's "Set up your MSP" instead of the vault.

const KEY = "keykeeperSetUpMsp";

describe("The way in from the website", () => {
  const route = Object.freeze({ queryParams: {} }) as ActivatedRouteSnapshot;
  const state = Object.freeze({}) as RouterStateSnapshot;
  const createUrlTree = jest.fn((commands: string[]) => commands.join("/"));
  let getAuthStatus: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    createUrlTree.mockClear();
    getAuthStatus = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { createUrlTree } },
        { provide: AuthService, useValue: { getAuthStatus: () => getAuthStatus() } },
      ],
    });
  });

  const start = () => TestBed.runInInjectionContext(async () => setUpMspGuard(route, state));
  const openVault = () => TestBed.runInInjectionContext(() => setUpMspRedirectGuard(route, state));

  it("sends someone signed out to sign up, and remembers why they came", async () => {
    getAuthStatus.mockResolvedValue(AuthenticationStatus.LoggedOut);

    expect(await start()).toBe("/signup");
    expect(localStorage.getItem(KEY)).toMatch(/^\d+$/);
  });

  it("then opens the MSP console in place of the vault, once", async () => {
    getAuthStatus.mockResolvedValue(AuthenticationStatus.LoggedOut);
    await start();

    // Signed up (or signed in from there): the vault would open next.
    expect(openVault()).toBe("/msp");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(openVault()).toBe(true);
  });

  it("takes someone signed in straight to the MSP console, with nothing to remember", async () => {
    getAuthStatus.mockResolvedValue(AuthenticationStatus.Unlocked);

    expect(await start()).toBe("/msp");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("takes someone locked to the MSP console too, which asks them to unlock first", async () => {
    getAuthStatus.mockResolvedValue(AuthenticationStatus.Locked);

    expect(await start()).toBe("/msp");
  });

  it("treats a browser with no account as signed out", async () => {
    getAuthStatus.mockRejectedValue(new Error("no active account"));

    expect(await start()).toBe("/signup");
  });

  it("opens the vault for everyone else, and after a day", () => {
    expect(openVault()).toBe(true);

    rememberSetUpMsp(localStorage, Date.now() - 25 * 60 * 60 * 1000);
    expect(openVault()).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
