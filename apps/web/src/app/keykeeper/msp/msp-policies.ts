// Keykeeper: how the MSP console shows default policies. A client follows a
// default while its policy matches it; the server says where a client has its
// own setting instead. A default required for every client reaches every
// client, and the server says which ones aren't in step yet (they refused
// it). See DESIGN.md, "Default policies" and "Required for every client".

import { DefaultPolicyResult, MspPolicies, MspPolicy } from "./msp-api.service";

type NamedClient = { id: string; name: string };

/**
 * One policy in Default policies: the default, whether it's required for
 * every client, and the clients: those with their own setting (never for a
 * required one), those that aren't in step with a required one, and those
 * that had their own setting before it was required.
 */
export type DefaultPolicyRow = {
  type: number;
  default: MspPolicy;
  required: boolean;
  own: NamedClient[];
  notInStep: NamedClient[];
  hadOwn: NamedClient[];
  /** How many clients the person sees. */
  clients: number;
};

const named = ({ id, name }: NamedClient): NamedClient => ({ id, name });

/** The rows for the policy types shown, in that order. */
export function defaultPolicyRows(policies: MspPolicies, shown: number[]): DefaultPolicyRow[] {
  return shown
    .filter((type) => policies.types.includes(type))
    .map((type) => {
      const policy = policies.defaults.find((p) => p.type === type) ?? {
        type,
        enabled: false,
        data: null,
      };
      return {
        type,
        default: policy,
        required: policy.required === true,
        own: policies.clients.filter((c) => c.own.some((p) => p.type === type)).map(named),
        notInStep: policies.clients
          .filter((c) => (c.notInStep ?? []).some((p) => p.type === type))
          .map(named),
        hadOwn: (policy.hadOwn ?? []).map(named),
        clients: policies.clients.length,
      };
    });
}

/**
 * Which clients a row reaches, in a few words: "all 14 clients" for a
 * required policy (or "12 of 14 clients" while some aren't in step), and
 * "12 follow, 2 have their own" for a default.
 */
export function rowClientsSummary(row: DefaultPolicyRow): string {
  const total = row.clients;
  if (total === 0) {
    return "No clients yet";
  }
  if (row.required) {
    const inStep = total - row.notInStep.length;
    if (inStep === total) {
      return total === 1 ? "1 client" : `all ${total} clients`;
    }
    return `${inStep} of ${total} clients`;
  }
  const own = row.own.length;
  const follow = total - own;
  if (own === 0) {
    return total === 1 ? "1 follows" : `All ${total} follow`;
  }
  const ownPart = `${own} ${own === 1 ? "has its" : "have their"} own`;
  if (follow === 0) {
    return total === 1 ? ownPart : `All ${ownPart}`;
  }
  return `${follow} ${follow === 1 ? "follows" : "follow"}, ${ownPart}`;
}

/** A client's policies in a few words: the defaults, or how many are its own or not in step. */
export function clientPolicySummary(
  policies: MspPolicies | null,
  clientId: string,
  shown: number[],
): string {
  const client = policies?.clients.find((c) => c.id === clientId);
  if (client == null) {
    return "";
  }
  const own = client.own.filter((p) => shown.includes(p.type)).length;
  const behind = (client.notInStep ?? []).filter((p) => shown.includes(p.type)).length;
  const parts = [];
  if (own > 0) {
    parts.push(own === 1 ? "1 own setting" : `${own} own settings`);
  }
  if (behind > 0) {
    parts.push(`${behind} required not in step`);
  }
  return parts.length === 0 ? "Defaults" : parts.join(", ");
}

/**
 * What a policy does, as the server compares them: nothing when it's off,
 * otherwise its options, where missing, empty, and null options are the same.
 */
export function policyEffect(policy: { enabled: boolean; data: any }): string | null {
  if (!policy.enabled) {
    return null;
  }
  const options =
    policy.data != null && typeof policy.data === "object" && !Array.isArray(policy.data)
      ? Object.fromEntries(
          Object.entries(policy.data)
            .filter(([, v]) => v != null)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : {};
  return JSON.stringify(options);
}

/**
 * The clients whose policy differs from `wanted`: every one a requirement
 * changes, whether it has its own setting, isn't in step, or follows the
 * default. `own` marks the ones that don't follow the default now.
 */
export function clientsRequiringChanges(
  policies: MspPolicies,
  type: number,
  wanted: { enabled: boolean; data: any },
): (NamedClient & { own: boolean; enabled: boolean })[] {
  const fallback = policies.defaults.find((p) => p.type === type) ?? {
    type,
    enabled: false,
    data: null,
  };
  const target = policyEffect(wanted);
  const out = [];
  for (const client of policies.clients) {
    const own = [...client.own, ...(client.notInStep ?? [])].find((p) => p.type === type);
    const current = own ?? fallback;
    if (policyEffect(current) !== target) {
      out.push({ ...named(client), own: own != null, enabled: current.enabled });
    }
  }
  return out;
}

/** Every client's name in a sentence, however many: "A", "A and B", "A, B, and C". */
export function allNames(clients: NamedClient[]): string {
  const names = clients.map((c) => c.name);
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** Client names in a sentence: "A", "A and B", "A, B, and C", or a count past three. */
export function clientList(clients: NamedClient[]): string {
  const names = clients.map((c) => c.name);
  if (names.length > 3) {
    return `${names.length} clients`;
  }
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** What changing a default or using it in clients did. */
export function describePolicyResult(result: Partial<DefaultPolicyResult>): string {
  const changed = result.changed ?? [];
  const kept = result.kept ?? [];
  const refused = result.refused ?? [];
  const parts = [
    changed.length === 0 ? "No client needed a change." : `Changed in ${clientList(changed)}.`,
  ];
  if (kept.length > 0) {
    parts.push(`${clientList(kept)} kept ${kept.length === 1 ? "its" : "their"} own setting.`);
  }
  for (const r of refused) {
    parts.push(`${r.name} refused it: ${r.error}`);
  }
  return parts.join(" ");
}
