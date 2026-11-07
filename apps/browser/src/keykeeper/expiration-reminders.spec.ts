import { mock } from "jest-mock-extended";

import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FieldType } from "@bitwarden/common/vault/enums";
import {
  EXPIRES_FIELD_NAME,
  REMIND_FIELD_NAME,
} from "@bitwarden/common/vault/keykeeper/expiration";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import {
  KeykeeperExpirationReminders,
  reminderLevel,
  reminderText,
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

  it.each([
    [100, null],
    [90, "90"],
    [31, "90"],
    [30, "30"],
    [10, "30"],
    [7, "7"],
    [1, "1"],
    [-3, "expired"],
  ])("with reminder days 90, 30, 7, and 1, %i days away is step %s", (days, level) => {
    expect(reminderLevel({ state: days < 0 ? "expired" : "soon", days }, [90, 30, 7, 1])).toBe(
      level,
    );
  });

  it("goes on from where an item stands when its reminder days change", () => {
    // Shown at 30 days; now at 50 days with 90-day reminders: nothing new.
    expect(shouldRemind({ date: "2026-11-01", level: "30" }, "2026-11-01", "90")).toBe(false);
    // Shown at 30; with 14 and 1, reaching 14 reminds.
    expect(shouldRemind({ date: "2026-11-01", level: "30" }, "2026-11-01", "14")).toBe(true);
    expect(shouldRemind({ date: "2026-11-01", level: "14" }, "2026-11-01", "expired")).toBe(true);
  });

  it("starts over when the expiry date changes", () => {
    expect(shouldRemind({ date: "2026-11-01", level: "expired" }, "2027-11-01", "30")).toBe(true);
  });

  describe("checking", () => {
    const now = new Date(2026, 9, 20, 12);
    const textField = (name: string, value: string) => {
      const field = new FieldView();
      field.name = name;
      field.type = FieldType.Text;
      field.value = value;
      return field;
    };
    const expiring = (remind?: string) => {
      const item = new CipherView();
      item.id = "item-1";
      item.name = "Firewall admin";
      item.fields = [textField(EXPIRES_FIELD_NAME, "2026-10-25")];
      if (remind != null) {
        item.fields.push(textField(REMIND_FIELD_NAME, remind));
      }
      return item;
    };

    function setUp(userId: UserId, item = expiring()) {
      const authService = mock<AuthService>();
      authService.getAuthStatus.mockResolvedValue(AuthenticationStatus.Unlocked);
      const accountService = mockAccountServiceWith(userId);
      const cipherService = mock<CipherService>();
      cipherService.getAllDecrypted.mockResolvedValue([item]);
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

      expect(await reminders.check(now)).toEqual(["1 item expires soon"]);
      expect(await reminders.check(now)).toEqual([]);
      // The notification says how many, never which: no item's name on the lock screen.
      const shownNotifications = ((chrome as any).notifications.create as jest.Mock).mock.calls;
      expect(shownNotifications).toHaveLength(1);
      expect(JSON.stringify(shownNotifications)).not.toContain("Firewall admin");

      expect(SHOWN_REMINDERS.clearOn).toEqual(["logout"]);
      expect(
        stateProvider.singleUser.getFake(userId, SHOWN_REMINDERS).nextMock,
      ).toHaveBeenCalledWith({
        "item-1": { date: "2026-10-25", level: "7" },
      });
    });

    it("follows an item's own reminder days, and never reminds about one that says not to", async () => {
      // Five days out: with only a 1-day reminder, nothing yet.
      expect(await setUp("user-2" as UserId, expiring("1")).reminders.check(now)).toEqual([]);
      expect(await setUp("user-3" as UserId, expiring("14,1")).reminders.check(now)).toEqual([
        "1 item expires soon",
      ]);
      expect(await setUp("user-4" as UserId, expiring("none")).reminders.check(now)).toEqual([]);
      const expired = new Date(2026, 9, 30, 12);
      expect(await setUp("user-5" as UserId, expiring("none")).reminders.check(expired)).toEqual(
        [],
      );
      expect(await setUp("user-6" as UserId, expiring("1")).reminders.check(expired)).toEqual([
        "1 item has expired",
      ]);
    });
  });

  it("counts the items in one notification, and says when they've expired", () => {
    expect(reminderText(["7"]).title).toBe("1 item expires soon");
    expect(reminderText(["30", "1"]).title).toBe("2 items expire soon");
    expect(reminderText(["expired"]).title).toBe("1 item has expired");
    expect(reminderText(["expired", "expired"]).title).toBe("2 items have expired");
    expect(reminderText(["expired", "7", "30"]).title).toBe("3 items expire soon or have expired");
  });
});
