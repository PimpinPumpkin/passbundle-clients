import { firstValueFrom } from "rxjs";

import {
  FakeAccountService,
  FakeStateProvider,
  mockAccountServiceWith,
} from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";

import {
  breachCheckSyncedPart,
  CHECK_AFTER_UNLOCK,
  KeykeeperBreachCheckSetting,
} from "./breach-check-setting.service";

const ALEX = "8f1c6a52-0b0e-4f3e-9a51-2c7d1e9b0a11" as UserId;
const SAM = "1d2e3f40-5a6b-4c7d-8e9f-a0b1c2d3e4f5" as UserId;

describe("Check my passwords against known breaches after unlocking", () => {
  let accountService: FakeAccountService;
  let setting: KeykeeperBreachCheckSetting;

  beforeEach(() => {
    accountService = mockAccountServiceWith(ALEX);
    setting = new KeykeeperBreachCheckSetting(
      new FakeStateProvider(accountService),
      accountService,
    );
  });

  it("is on until the person turns it off, per account", async () => {
    expect(await firstValueFrom(setting.checksAfterUnlock$(ALEX))).toBe(true);
    expect(await firstValueFrom(setting.activeChecksAfterUnlock$)).toBe(true);

    await setting.setChecksAfterUnlock(ALEX, false);
    expect(await firstValueFrom(setting.checksAfterUnlock$(ALEX))).toBe(false);
    expect(await firstValueFrom(setting.activeChecksAfterUnlock$)).toBe(false);
    // Another account on the same browser keeps its own.
    expect(await firstValueFrom(setting.checksAfterUnlock$(SAM))).toBe(true);

    await setting.setChecksAfterUnlock(ALEX, true);
    expect(await firstValueFrom(setting.checksAfterUnlock$(ALEX))).toBe(true);
  });

  it("follows a change made in another tab of the web vault", async () => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: CHECK_AFTER_UNLOCK.buildKey(ALEX), newValue: "false" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await firstValueFrom(setting.checksAfterUnlock$(ALEX))).toBe(false);

    // Another account's change, or another key, isn't this one's.
    window.dispatchEvent(
      new StorageEvent("storage", { key: CHECK_AFTER_UNLOCK.buildKey(SAM), newValue: "true" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else", newValue: "true" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await firstValueFrom(setting.checksAfterUnlock$(ALEX))).toBe(false);

    window.dispatchEvent(
      new StorageEvent("storage", { key: CHECK_AFTER_UNLOCK.buildKey(ALEX), newValue: "true" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await firstValueFrom(setting.checksAfterUnlock$(ALEX))).toBe(true);
  });

  describe("following the account (the settings document's health part)", () => {
    let stateProvider: FakeStateProvider;
    const on = () => firstValueFrom(stateProvider.getUser(ALEX, CHECK_AFTER_UNLOCK).state$);

    beforeEach(() => {
      stateProvider = new FakeStateProvider(accountService);
    });

    it("keeps never set apart from on when read back from the browser's storage", () => {
      expect(CHECK_AFTER_UNLOCK.deserializer(null as never)).toBeNull();
      expect(CHECK_AFTER_UNLOCK.deserializer(false)).toBe(false);
      expect(CHECK_AFTER_UNLOCK.deserializer(true)).toBe(true);
    });

    it("says what's here in the document's terms, and whether it was set here", async () => {
      const part = breachCheckSyncedPart(stateProvider);
      expect(part.name).toBe("health");
      expect(await firstValueFrom(part.here$(ALEX))).toEqual({
        value: { checkAfterUnlock: true },
        chosen: false,
      });
      await stateProvider.getUser(ALEX, CHECK_AFTER_UNLOCK).update(() => false);
      expect(await firstValueFrom(part.here$(ALEX))).toEqual({
        value: { checkAfterUnlock: false },
        chosen: true,
      });
    });

    it("takes the document's switch, unless it changed here since it was last taken", async () => {
      const part = breachCheckSyncedPart(stateProvider);
      expect(await part.take(ALEX, { checkAfterUnlock: false }, undefined)).toBe(true);
      expect(await on()).toBe(false);

      // Turned back on here after taking "off": this device's goes back.
      await stateProvider.getUser(ALEX, CHECK_AFTER_UNLOCK).update(() => true);
      expect(await part.take(ALEX, { checkAfterUnlock: false }, '{"checkAfterUnlock":false}')).toBe(
        false,
      );
      expect(await on()).toBe(true);
    });

    it("keeps what's here when the document has nothing it understands", async () => {
      const part = breachCheckSyncedPart(stateProvider);
      await stateProvider.getUser(ALEX, CHECK_AFTER_UNLOCK).update(() => false);
      for (const nothing of [undefined, null, {}, { checkAfterUnlock: "no" }, "off"]) {
        expect(await part.take(ALEX, nothing, '{"checkAfterUnlock":false}')).toBe(true);
        expect(await on()).toBe(false);
      }
    });
  });
});
