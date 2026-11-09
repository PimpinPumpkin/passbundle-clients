import { mock } from "jest-mock-extended";

import { ApiService } from "../../abstractions/api.service";

import {
  keykeeperAnswerNewDeviceRequest,
  keykeeperListNewDeviceRequests,
  keykeeperNewDeviceCheckStatus,
  keykeeperParseNewDeviceCheck,
  keykeeperRememberNewDeviceCheck,
  keykeeperTakeNewDeviceCheck,
  keykeeperTypedNumber,
} from "./new-device-check";

const raw = {
  id: "c1",
  token: "t".repeat(43),
  number: "47",
  status: "waiting",
  deniedWhy: null,
  expiresAt: "2026-11-08T12:10:00.000000Z",
  approvers: true,
  email: "later",
  emailAfter: null,
  codeSent: false,
};

describe("the new-device check", () => {
  it("reads the server's check", () => {
    const check = keykeeperParseNewDeviceCheck(raw);
    expect(check).toEqual({ ...raw, emailTo: null });
  });

  it("keeps the token it had when an answer has none", () => {
    const { token, ...withoutToken } = raw;
    expect(keykeeperParseNewDeviceCheck(withoutToken, token)?.token).toBe(token);
    expect(keykeeperParseNewDeviceCheck(withoutToken)).toBeNull();
  });

  it("refuses what isn't a check", () => {
    for (const bad of [
      null,
      "x",
      {},
      { ...raw, number: "7" },
      { ...raw, number: "470" },
      { ...raw, id: 3 },
    ]) {
      expect(keykeeperParseNewDeviceCheck(bad)).toBeNull();
    }
    // Unknown states read as the safest ones.
    const odd = keykeeperParseNewDeviceCheck({ ...raw, status: "maybe", email: "always" });
    expect(odd?.status).toBe("waiting");
    expect(odd?.email).toBe("never");
  });

  it("takes only two digits as an answer, so a tap alone never approves", () => {
    expect(keykeeperTypedNumber("47")).toBe("47");
    expect(keykeeperTypedNumber(" 47 ")).toBe("47");
    for (const nothing of ["", " ", "4", "470", "4a", "+4"]) {
      expect(keykeeperTypedNumber(nothing)).toBeNull();
    }
  });

  it("asks with the id and token in the body, never the address", async () => {
    const api = mock<ApiService>();
    api.send.mockResolvedValue({ ...raw, token: undefined, status: "approved" });
    const check = keykeeperParseNewDeviceCheck(raw)!;
    const now = await keykeeperNewDeviceCheckStatus(api, check);
    expect(api.send).toHaveBeenCalledWith(
      "POST",
      "/keykeeper/new-device-check/status",
      { id: "c1", token: raw.token },
      false,
      true,
    );
    expect(now?.status).toBe("approved");
    expect(now?.token).toBe(raw.token);
  });

  it("approves with the number, and denies without one", async () => {
    const api = mock<ApiService>();
    api.send.mockResolvedValue({ approved: true, denied: false });
    expect(await keykeeperAnswerNewDeviceRequest(api, "c 1", "47")).toEqual({
      approved: true,
      denied: false,
      deniedWhy: null,
    });
    expect(api.send).toHaveBeenLastCalledWith(
      "POST",
      "/keykeeper/new-device-checks/c%201/approve",
      { number: "47" },
      true,
      true,
    );
    api.send.mockResolvedValue({ approved: false, denied: true, deniedWhy: "denied" });
    await keykeeperAnswerNewDeviceRequest(api, "c1", null);
    expect(api.send).toHaveBeenLastCalledWith(
      "POST",
      "/keykeeper/new-device-checks/c1/deny",
      null,
      true,
      true,
    );
  });

  it("lists the waiting sign-ins, never with a number", async () => {
    const api = mock<ApiService>();
    api.send.mockResolvedValue({
      data: [
        {
          id: "c1",
          device: "Web vault in Firefox",
          ipAddress: "203.0.113.7",
          location: "Fixture City, Germany",
          creationDate: "2026-11-08T12:00:00Z",
          expirationDate: "2026-11-08T12:10:00Z",
          emailAfter: null,
          number: "47",
        },
        { nothing: true },
      ],
      locationSource: { name: "DB-IP", url: "https://db-ip.com" },
    });
    const { requests, source } = await keykeeperListNewDeviceRequests(api);
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("number");
    expect(requests[0].location).toBe("Fixture City, Germany");
    expect(source).toEqual({ name: "DB-IP", url: "https://db-ip.com" });
  });

  it("hands the waiting page its check once", () => {
    const check = keykeeperParseNewDeviceCheck(raw);
    keykeeperRememberNewDeviceCheck(check);
    expect(keykeeperTakeNewDeviceCheck()).toBe(check);
    expect(keykeeperTakeNewDeviceCheck()).toBeNull();
  });
});
