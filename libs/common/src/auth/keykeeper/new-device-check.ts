// Keykeeper: the new-device check (DESIGN.md, "New-device check"). An
// account without two-step login that signs in on a device it has never used
// waits until the person types the number this device shows into a device
// already signed in, or gives a code sent by email. These are the calls and
// shapes both sides use: the new device (with no session, by the check's id
// and token) and the account's other devices (with their session).

import { ApiService } from "../../abstractions/api.service";

/** How the new device's check stands, as the server says. */
export type KeykeeperNewDeviceCheck = {
  id: string;
  /** Only the new device gets it; kept in memory only. */
  token: string;
  /** The two digits to type on the other device. */
  number: string;
  status: "waiting" | "approved" | "denied";
  /** "number" (a wrong one was typed) or "denied". */
  deniedWhy: string | null;
  expiresAt: string;
  /** Whether any of the account's devices can approve it. */
  approvers: boolean;
  /**
   * "now": a code can be sent by email. "later": the person may ask for one
   * after a day's wait. "waiting": asked, until `emailAfter`. "never".
   */
  email: "now" | "later" | "waiting" | "never";
  emailAfter: string | null;
  codeSent: boolean;
  emailTo: string | null;
};

/** A check waiting for an answer, as the account's other devices list it. */
export type KeykeeperNewDeviceRequest = {
  id: string;
  /** "Web vault in Firefox", from the device's kind, never its own name. */
  device: string;
  ipAddress: string;
  /** "Berlin, Germany", or null when unknown. */
  location: string | null;
  creationDate: string;
  expirationDate: string;
  emailAfter: string | null;
};

export type KeykeeperLocationSource = { name: string; url: string | null };

const EMAIL_STATES = ["now", "later", "waiting", "never"];
const STATUSES = ["waiting", "approved", "denied"];

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The server's check, or null when the answer isn't one. */
export function keykeeperParseNewDeviceCheck(
  raw: any,
  token?: string,
): KeykeeperNewDeviceCheck | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const id = text(raw.id);
  const number = text(raw.number);
  const tok = text(raw.token) ?? token ?? null;
  if (!id || !number || !/^\d{2}$/.test(number) || !tok) {
    return null;
  }
  return {
    id,
    token: tok,
    number,
    status: STATUSES.includes(raw.status) ? raw.status : "waiting",
    deniedWhy: text(raw.deniedWhy),
    expiresAt: text(raw.expiresAt) ?? "",
    approvers: raw.approvers === true,
    email: EMAIL_STATES.includes(raw.email) ? raw.email : "never",
    emailAfter: text(raw.emailAfter),
    codeSent: raw.codeSent === true,
    emailTo: text(raw.emailTo),
  };
}

/** Only two digits count as an answer: a tap alone never approves. */
export function keykeeperTypedNumber(typed: string): string | null {
  const t = (typed ?? "").trim();
  return /^\d{2}$/.test(t) ? t : null;
}

/** The new device asks how its check stands. */
export async function keykeeperNewDeviceCheckStatus(
  api: ApiService,
  check: KeykeeperNewDeviceCheck,
): Promise<KeykeeperNewDeviceCheck | null> {
  const r = await api.send(
    "POST",
    "/keykeeper/new-device-check/status",
    { id: check.id, token: check.token },
    false,
    true,
  );
  return keykeeperParseNewDeviceCheck(r, check.token);
}

/** "Email me a code", or a code by email after the wait. */
export async function keykeeperNewDeviceCheckEmail(
  api: ApiService,
  check: KeykeeperNewDeviceCheck,
): Promise<KeykeeperNewDeviceCheck | null> {
  const r = await api.send(
    "POST",
    "/keykeeper/new-device-check/email",
    { id: check.id, token: check.token },
    false,
    true,
  );
  return keykeeperParseNewDeviceCheck(r, check.token);
}

/** The account's checks waiting for an answer, for this signed-in device. */
export async function keykeeperListNewDeviceRequests(
  api: ApiService,
): Promise<{ requests: KeykeeperNewDeviceRequest[]; source: KeykeeperLocationSource | null }> {
  const r = await api.send("GET", "/keykeeper/new-device-checks", null, true, true);
  const requests: KeykeeperNewDeviceRequest[] = (Array.isArray(r?.data) ? r.data : [])
    .filter((d: any) => typeof d?.id === "string")
    .map((d: any) => ({
      id: d.id,
      device: text(d.device) ?? "",
      ipAddress: text(d.ipAddress) ?? "",
      location: text(d.location),
      creationDate: text(d.creationDate) ?? "",
      expirationDate: text(d.expirationDate) ?? "",
      emailAfter: text(d.emailAfter),
    }));
  const s = r?.locationSource;
  const source = typeof s?.name === "string" ? { name: s.name, url: text(s.url) } : null;
  return { requests, source };
}

/** Approve with the number typed (a wrong one denies it), or deny. */
export async function keykeeperAnswerNewDeviceRequest(
  api: ApiService,
  id: string,
  number: string | null,
): Promise<{ approved: boolean; denied: boolean; deniedWhy: string | null }> {
  const path = `/keykeeper/new-device-checks/${encodeURIComponent(id)}/${number == null ? "deny" : "approve"}`;
  const r = await api.send("POST", path, number == null ? null : { number }, true, true);
  return {
    approved: r?.approved === true,
    denied: r?.denied === true,
    deniedWhy: text(r?.deniedWhy),
  };
}

/**
 * The check the last sign-in got, handed to the waiting page in memory, so
 * it needn't sign in again to see it. Taken once.
 */
let lastCheck: KeykeeperNewDeviceCheck | null = null;

export function keykeeperRememberNewDeviceCheck(check: KeykeeperNewDeviceCheck | null) {
  lastCheck = check;
}

export function keykeeperTakeNewDeviceCheck(): KeykeeperNewDeviceCheck | null {
  const found = lastCheck;
  lastCheck = null;
  return found;
}
