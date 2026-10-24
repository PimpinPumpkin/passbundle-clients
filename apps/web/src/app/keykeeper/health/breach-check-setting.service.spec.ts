import { firstValueFrom } from "rxjs";

import {
  FakeAccountService,
  FakeStateProvider,
  mockAccountServiceWith,
} from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";

import { CHECK_AFTER_UNLOCK, KeykeeperBreachCheckSetting } from "./breach-check-setting.service";

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
});
