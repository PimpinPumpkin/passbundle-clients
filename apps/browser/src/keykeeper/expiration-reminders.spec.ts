import { mock } from "jest-mock-extended";

import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FieldType } from "@bitwarden/common/vault/enums";
import { EXPIRES_FIELD_NAME } from "@bitwarden/common/vault/keykeeper/expiration";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import {
  KeykeeperExpirationReminders,
  reminderLevel,
  SHOWN_REMINDERS,
  shouldRemind,
} from "./expiration-reminders";

describe("Keykeeper expiration reminders", () => {
  it.each([
    [45, null],
    [31, null],
    [30, "30"],
    [8, "30"],
    [7, "7"],
    [2, "7"],
    [1, "1"],
    [0, "1"],
    [-1, "expired"],
  ])("%i days away is reminder step %s", (days, level) => {
    expect(reminderLevel({ state: days < 0 ? "expired" : "soon", days })).toBe(level);
  });

  it("reminds once per step, and again when the item reaches a more urgent one", () => {
    expect(shouldRemind(undefined, "2026-11-01", "30")).toBe(true);
    expect(shouldRemind({ date: "2026-11-01", level: "30" }, "2026-11-01", "30")).toBe(false);
    expect(shouldRemind({ date: "2026-11-01", level: "30" }, "2026-11-01", "7")).toBe(true);
    expect(shouldRemind({ date: "2026-11-01", level: "expired" }, "2026-11-01", "1")).toBe(false);
  });

  it("starts over when the expiry date changes", () => {
    expect(shouldRemind({ date: "2026-11-01", level: "expired" }, "2027-11-01", "30")).toBe(true);
  });

  describe("checking", () => {
    const now = new Date(2026, 9, 20, 12);
    const expiring = () => {
      const item = new CipherView();
      item.id = "item-1";
      item.name = "Firewall admin";
      const expires = new FieldView();
      expires.name = EXPIRES_FIELD_NAME;
      expires.type = FieldType.Text;
      expires.value = "2026-10-25";
      item.fields = [expires];
      return item;
    };

    function setUp(userId: UserId) {
      const authService = mock<AuthService>();
      authService.getAuthStatus.mockResolvedValue(AuthenticationStatus.Unlocked);
      const accountService = mockAccountServiceWith(userId);
      const cipherService = mock<CipherService>();
      cipherService.getAllDecrypted.mockResolvedValue([expiring()]);
      const stateProvider = new FakeStateProvider(accountService);
      (chrome as any).notifications = { create: jest.fn() };
      const reminders = new KeykeeperExpirationReminders(
        authService,
        accountService,
        cipherService,
        stateProvider,
      );
      return { reminders, stateProvider };
    }

    it("remembers what it showed for the account, in state that logout clears", async () => {
      const userId = "user-1" as UserId;
      const { reminders, stateProvider } = setUp(userId);

      expect(await reminders.check(now)).toEqual(["Firewall admin: expires in 5 days"]);
      expect(await reminders.check(now)).toEqual([]);

      expect(SHOWN_REMINDERS.clearOn).toEqual(["logout"]);
      expect(
        stateProvider.singleUser.getFake(userId, SHOWN_REMINDERS).nextMock,
      ).toHaveBeenCalledWith({
        "item-1": { date: "2026-10-25", level: "7" },
      });
    });
  });
});
