import { KEYKEEPER_PASSWORD_CHANGE_OFF_POLICY } from "@bitwarden/admin-console/common";

import { BasePolicyEditDefinition } from "../../admin-console/organizations/policies";

import { KeykeeperPasswordChangeOffPolicy, withPasswordChangeOff } from "./password-change-policy";

describe("Keykeeper: turning off assisted password change as an MSP default", () => {
  const upstream = [{ type: 0 }, { type: 1 }] as BasePolicyEditDefinition[];

  it("comes last, when the server offers it", () => {
    const out = withPasswordChangeOff(upstream, [0, 1, KEYKEEPER_PASSWORD_CHANGE_OFF_POLICY]);
    expect(out.map((d) => d.type)).toEqual([0, 1, KEYKEEPER_PASSWORD_CHANGE_OFF_POLICY]);
    expect(out[2]).toBeInstanceOf(KeykeeperPasswordChangeOffPolicy);
  });

  it("isn't there on a server that doesn't offer it", () => {
    expect(withPasswordChangeOff(upstream, [0, 1])).toEqual(upstream);
  });
});
