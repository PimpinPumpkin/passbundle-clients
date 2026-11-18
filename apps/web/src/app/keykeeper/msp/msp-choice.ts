// Keykeeper: which MSP the console works on, for someone on the staff of
// several (DESIGN.md, "Several MSPs"). The server lets one person be staff of
// any number of MSPs, and each client belongs to at most one. The console
// shows one MSP at a time, chosen at its top and remembered in this browser,
// per account; every request it makes names that MSP.

import { MspSummary } from "@bitwarden/admin-console/common";

const KEY = "keykeeperMspChoice";

/**
 * The MSP to show: the one remembered in this browser if the person is still
 * on its staff, otherwise the first the server lists. None for someone on no
 * MSP's staff.
 */
export function chosenMsp(msps: MspSummary[], remembered: string | null): MspSummary | null {
  return msps.find((m) => m.id === remembered) ?? msps[0] ?? null;
}

/** Each MSP's line in the choice: its name and the person's role there. */
export function mspChoiceLabel(msp: MspSummary): string {
  return `${msp.name} (${msp.role === "admin" ? "Admin" : "Technician"})`;
}

/**
 * The MSP this browser remembers for an account. Storage can be missing or
 * refuse (a private window, blocked site data); then nothing is remembered.
 */
export function rememberedMsp(storage: Storage | null | undefined, userId: string): string | null {
  try {
    const value = storage?.getItem(`${KEY}.${userId}`);
    return value == null || value === "" ? null : value;
  } catch {
    return null;
  }
}

/** Remembers an account's MSP in this browser, when it can. */
export function rememberMsp(storage: Storage | null | undefined, userId: string, mspId: string) {
  try {
    storage?.setItem(`${KEY}.${userId}`, mspId);
  } catch {
    // Not remembered: the console shows the first MSP next time.
  }
}

/** This browser's storage, or none where reading it throws. */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
