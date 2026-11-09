import {
  KEYKEEPER_ADMIN_TWO_STEP_POLICY,
  KEYKEEPER_MEMBER_HEALTH_POLICY,
} from "@bitwarden/admin-console/common";
import { PolicyType } from "@bitwarden/common/admin-console/enums";

import { BasePolicyEditDefinition } from "../../admin-console/organizations/policies";
import { membersPhrase, twoStepRoleLabel } from "../organizations/admin-two-step.component";

import { everyoneData, requiresEveryone, withAdminTwoStep } from "./admin-two-step-policy";
import { KeykeeperMemberHealthPolicy, withMemberHealth } from "./member-health-policy";

describe("two-step login for admins as an MSP default", () => {
  it("keeps its one option, everyone else too, and null without it", () => {
    expect(everyoneData(true, true)).toEqual({ everyone: true });
    expect(everyoneData(true, false)).toBeNull();
    // Off is off: the option goes with it.
    expect(everyoneData(false, true)).toBeNull();
  });

  it("reads the option only when it's true", () => {
    expect(requiresEveryone({ everyone: true })).toBe(true);
    for (const data of [null, undefined, {}, { everyone: false }, { everyone: "true" }]) {
      expect(requiresEveryone(data)).toBe(false);
    }
  });

  it("comes right after upstream's two-step login when the server offers it", () => {
    const definition = (type: number) => ({ type }) as BasePolicyEditDefinition;
    const upstream = [
      definition(PolicyType.TwoFactorAuthentication),
      definition(PolicyType.SingleOrg),
    ];
    expect(withAdminTwoStep(upstream, []).map((d) => d.type)).toEqual([
      PolicyType.TwoFactorAuthentication,
      PolicyType.SingleOrg,
    ]);
    expect(
      withAdminTwoStep(upstream, [KEYKEEPER_ADMIN_TWO_STEP_POLICY]).map((d) => d.type),
    ).toEqual([
      PolicyType.TwoFactorAuthentication,
      KEYKEEPER_ADMIN_TWO_STEP_POLICY,
      PolicyType.SingleOrg,
    ]);
  });
});

describe("Members' own passwords as an MSP default", () => {
  it("comes last when the server offers it", () => {
    const definition = (type: number) => ({ type }) as BasePolicyEditDefinition;
    const upstream = [
      definition(PolicyType.TwoFactorAuthentication),
      definition(PolicyType.SingleOrg),
    ];
    expect(withMemberHealth(upstream, []).map((d) => d.type)).toEqual([
      PolicyType.TwoFactorAuthentication,
      PolicyType.SingleOrg,
    ]);
    const offered = withMemberHealth(upstream, [KEYKEEPER_MEMBER_HEALTH_POLICY]);
    expect(offered.map((d) => d.type)).toEqual([
      PolicyType.TwoFactorAuthentication,
      PolicyType.SingleOrg,
      KEYKEEPER_MEMBER_HEALTH_POLICY,
    ]);
    expect(offered.at(-1)).toBeInstanceOf(KeykeeperMemberHealthPolicy);
    expect(offered.at(-1)!.name).toBe("keykeeperMemberHealthPolicy");
  });
});

describe("the people two-step login lists", () => {
  it("names a member's role", () => {
    const person = (role: string) => ({ userId: "u", email: "e", name: null, role });
    expect(twoStepRoleLabel(person("owner"))).toBe("Owner");
    expect(twoStepRoleLabel(person("member"))).toBe("Member");
    expect(twoStepRoleLabel(person("custom"))).toBe("Custom role");
  });

  it("counts members in words", () => {
    expect(membersPhrase(1)).toBe("1 member");
    expect(membersPhrase(3)).toBe("3 members");
  });
});
