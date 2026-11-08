import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { awaitAsync, mockAccountServiceWith } from "../../../spec";
import { ApiService } from "../../abstractions/api.service";
import { OrganizationService } from "../../admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationUserStatusType } from "../../admin-console/enums";
import { Organization } from "../../admin-console/models/domain/organization";
import { AuthService } from "../../auth/abstractions/auth.service";
import { AuthenticationStatus } from "../../auth/enums/authentication-status";
import { LogService } from "../../platform/abstractions/log.service";
import { UserId } from "../../types/guid";
import { CipherService } from "../../vault/abstractions/cipher.service";
import { CipherType } from "../../vault/enums";
import { CipherView } from "../../vault/models/view/cipher.view";
import { LoginView } from "../../vault/models/view/login.view";

import { KeykeeperOwnHealthReporter, KeykeeperOwnHealthWatch, ownHealthCounts } from "./own-health";

const USER = "user-1" as UserId;
let nextId = 0;

function login(password: string, more: Partial<CipherView> = {}): CipherView {
  const cipher = new CipherView();
  cipher.id = `item-${nextId++}`;
  cipher.type = CipherType.Login;
  cipher.name = `Login ${nextId}`;
  cipher.edit = true;
  cipher.viewPassword = true;
  cipher.login = new LoginView();
  cipher.login.password = password;
  return Object.assign(cipher, more);
}

/** Weak by length, so the tests don't depend on the strength library. */
const weakByLength = (cipher: CipherView) => cipher.login.password.length < 12;

describe("Members' own passwords, in numbers", () => {
  const vault = () => [
    login("short"),
    login("a-long-shared-passphrase"),
    login("a-long-shared-passphrase"),
    login("long-but-in-a-breach"),
    // An organization's items aren't the person's own.
    login("short2", { organizationId: "org-1" }),
    login("a-long-shared-passphrase", { organizationId: "org-1" }),
    // Nor anything in the trash.
    login("short3", { deletedDate: new Date() }),
  ];

  it("counts only the logins in Personal: how many, weak, and reused among them", () => {
    expect(ownHealthCounts(vault(), weakByLength)).toEqual({ logins: 4, weak: 1, reused: 2 });
  });

  it("says how many are exposed only when every one was checked", () => {
    const allChecked = new Map<string, number | null>([
      ["short", 0],
      ["a-long-shared-passphrase", 0],
      ["long-but-in-a-breach", 12],
    ]);
    expect(ownHealthCounts(vault(), weakByLength, allChecked).exposed).toBe(1);

    const oneFailed = new Map(allChecked).set("short", null);
    expect(ownHealthCounts(vault(), weakByLength, oneFailed).exposed).toBeUndefined();
    expect(ownHealthCounts([], weakByLength, new Map()).exposed).toBe(0);
  });

  it("carries numbers and nothing else", () => {
    const counts = ownHealthCounts(vault(), weakByLength);
    expect(Object.keys(counts).sort()).toEqual(["logins", "reused", "weak"]);
    expect(JSON.stringify(counts)).not.toMatch(/Login|short|passphrase|item-/);
  });

  describe("sending them", () => {
    const member = (status: OrganizationUserStatusType) =>
      Object.assign(new Organization(), { id: "org-1", status });
    let api: ReturnType<typeof mock<ApiService>>;
    let organizations: BehaviorSubject<Organization[]>;
    let reporter: KeykeeperOwnHealthReporter;

    beforeEach(() => {
      api = mock<ApiService>();
      organizations = new BehaviorSubject([member(OrganizationUserStatusType.Confirmed)]);
      const organizationService = mock<OrganizationService>();
      organizationService.organizations$.mockReturnValue(organizations);
      reporter = new KeykeeperOwnHealthReporter(api, organizationService, mock<LogService>());
    });

    it("puts the numbers to the server, once until they change or the next unlock", async () => {
      const counts = { logins: 4, weak: 1, reused: 2 };
      expect(await reporter.report(USER, counts)).toBe(true);
      expect(api.send).toHaveBeenCalledWith("PUT", "/keykeeper/own-health", counts, true, true);

      expect(await reporter.report(USER, { ...counts })).toBe(false);
      expect(await reporter.report(USER, { ...counts, weak: 0 })).toBe(true);
      reporter.forget(USER);
      expect(await reporter.report(USER, { ...counts, weak: 0 })).toBe(true);
      expect(api.send).toHaveBeenCalledTimes(3);
    });

    it("sends nothing for someone who isn't a confirmed member of an organization", async () => {
      organizations.next([member(OrganizationUserStatusType.Accepted)]);
      expect(await reporter.report(USER, { logins: 1, weak: 0, reused: 0 })).toBe(false);
      organizations.next([]);
      expect(await reporter.report(USER, { logins: 1, weak: 0, reused: 0 })).toBe(false);
      expect(api.send).not.toHaveBeenCalled();
    });

    it("stops asking a server that doesn't have it, and never fails", async () => {
      api.send.mockRejectedValueOnce({ statusCode: 500 });
      expect(await reporter.report(USER, { logins: 1, weak: 0, reused: 0 })).toBe(false);
      api.send.mockRejectedValueOnce({ statusCode: 404 });
      expect(await reporter.report(USER, { logins: 1, weak: 0, reused: 0 })).toBe(false);
      expect(await reporter.report(USER, { logins: 2, weak: 0, reused: 0 })).toBe(false);
      expect(api.send).toHaveBeenCalledTimes(2);
    });
  });

  it("in the extension, counts weak and reused after unlocking and reports them", async () => {
    const api = mock<ApiService>();
    const organizationService = mock<OrganizationService>();
    organizationService.organizations$.mockReturnValue(
      of([Object.assign(new Organization(), { status: OrganizationUserStatusType.Confirmed })]),
    );
    const authService = mock<AuthService>();
    authService.authStatusFor$.mockReturnValue(of(AuthenticationStatus.Unlocked));
    const cipherService = mock<CipherService>();
    cipherService.cipherViews$.mockReturnValue(of(vault()));
    const watch = new KeykeeperOwnHealthWatch(
      mockAccountServiceWith(USER),
      authService,
      cipherService,
      (password) => (password.length < 12 ? 1 : 4),
      new KeykeeperOwnHealthReporter(api, organizationService, mock<LogService>()),
      1,
      1,
    );

    const running = watch.start();
    await awaitAsync(40);
    running.unsubscribe();

    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith(
      "PUT",
      "/keykeeper/own-health",
      { logins: 4, weak: 1, reused: 2 },
      true,
      true,
    );
  });
});
