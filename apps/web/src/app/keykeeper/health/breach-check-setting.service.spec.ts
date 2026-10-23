import { firstValueFrom } from "rxjs";

import {
  FakeAccountService,
  FakeStateProvider,
  mockAccountServiceWith,
} from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";

import { KeykeeperBreachCheckSetting } from "./breach-check-setting.service";

const ALEX = "user-alex" as UserId;
const SAM = "user-sam" as UserId;

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
});
