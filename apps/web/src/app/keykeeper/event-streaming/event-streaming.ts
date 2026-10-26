// Keykeeper: the places an organization's or an MSP's events are sent (its
// SIEM or MDR service), as the server reports them, and the requests that
// change them. Secrets (a webhook's URL, its signing secret, a header's
// value, Sentinel's client secret) go to the server and never come back: the
// form leaves them blank to keep what's saved. See DESIGN.md, "Sending events
// to security tools", in the meta repo.

export type DestinationKind = "webhook" | "syslog" | "sentinel";
export type DestinationStatus = "on" | "slow" | "failing" | "paused" | "off";

export type Destination = {
  id: string;
  name: string;
  kind: DestinationKind;
  enabled: boolean;
  /** Where events go, without anything secret: a webhook's host, never its path. */
  target: string;
  status: DestinationStatus;
  pausedReason: string | null;
  failures: number;
  failingSince: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  queued: number;
  dropped: number;
  createdAt: string;
  updatedAt: string;
  webhook?: { headerName: string | null; caCertificate: string | null };
  syslog?: { host: string; port: number; format: "json" | "cef"; caCertificate: string | null };
  sentinel?: {
    tenantId: string;
    clientId: string;
    endpoint: string;
    ruleId: string;
    stream: string;
    hasClientSecret: boolean;
  };
  /** A webhook's signing secret, only in the answer that made it. */
  signingSecret?: string;
};

export type DestinationList = {
  data: Destination[];
  maxDestinations: number;
  /** Whether the server's admin allows any private networks. */
  privateNetworks: boolean;
};

/** Whose destinations: an organization's, or an MSP's (every client's events and its own activity). */
export type StreamingScope = { kind: "organization" | "msp"; id: string };

/** What the form holds. Blank secrets keep what's saved. */
export type DestinationForm = {
  name: string;
  kind: DestinationKind;
  url: string;
  headerName: string;
  headerValue: string;
  caCertificate: string;
  host: string;
  port: number | null;
  format: "json" | "cef";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  endpoint: string;
  ruleId: string;
  stream: string;
};

export const KIND_NAMES: Record<DestinationKind, string> = {
  webhook: "Webhook (HTTPS)",
  syslog: "Syslog over TLS",
  sentinel: "Microsoft Sentinel",
};

export function emptyForm(): DestinationForm {
  return {
    name: "",
    kind: "webhook",
    url: "",
    headerName: "",
    headerValue: "",
    caCertificate: "",
    host: "",
    port: 6514,
    format: "json",
    tenantId: "",
    clientId: "",
    clientSecret: "",
    endpoint: "",
    ruleId: "",
    stream: "Custom-PassBundleEvents",
  };
}

/** The form for editing a destination: its settings, with every secret blank. */
export function formFor(d: Destination): DestinationForm {
  const form = { ...emptyForm(), name: d.name, kind: d.kind };
  if (d.webhook) {
    form.headerName = d.webhook.headerName ?? "";
    form.caCertificate = d.webhook.caCertificate ?? "";
  }
  if (d.syslog) {
    form.host = d.syslog.host;
    form.port = d.syslog.port;
    form.format = d.syslog.format;
    form.caCertificate = d.syslog.caCertificate ?? "";
  }
  if (d.sentinel) {
    form.tenantId = d.sentinel.tenantId;
    form.clientId = d.sentinel.clientId;
    form.endpoint = d.sentinel.endpoint;
    form.ruleId = d.sentinel.ruleId;
    form.stream = d.sentinel.stream;
  }
  return form;
}

const trimmed = (s: string) => s.trim();
/** A secret to send: what was typed, or nothing to keep the saved one. */
const secret = (s: string) => (s.trim() === "" ? undefined : s.trim());

/**
 * The request that saves the form: for a new destination (`editing` null)
 * every setting, for an existing one its settings and only the secrets that
 * were typed. Clearing an optional setting (a header, a certificate
 * authority) sends "" to remove it.
 */
export function requestFor(form: DestinationForm, editing: Destination | null) {
  const base = { name: trimmed(form.name), ...(editing ? {} : { kind: form.kind }) };
  switch (form.kind) {
    case "webhook": {
      const headerName = trimmed(form.headerName);
      return {
        ...base,
        webhook: {
          url: editing ? secret(form.url) : trimmed(form.url),
          headerName,
          headerValue: headerName === "" ? undefined : secret(form.headerValue),
          caCertificate: trimmed(form.caCertificate),
        },
      };
    }
    case "syslog":
      return {
        ...base,
        syslog: {
          host: trimmed(form.host),
          port: form.port ?? 6514,
          format: form.format,
          caCertificate: trimmed(form.caCertificate),
        },
      };
    case "sentinel":
      return {
        ...base,
        sentinel: {
          tenantId: trimmed(form.tenantId),
          clientId: trimmed(form.clientId),
          clientSecret: editing ? secret(form.clientSecret) : trimmed(form.clientSecret),
          endpoint: trimmed(form.endpoint),
          ruleId: trimmed(form.ruleId),
          stream: trimmed(form.stream),
        },
      };
  }
}

export type StatusView = {
  label: string;
  variant: "success" | "primary" | "warning" | "danger" | "secondary";
  /** Why, when something's wrong. */
  detail: string | null;
};

/** How a destination is doing, for its badge and the line under it. */
export function statusView(d: Destination): StatusView {
  switch (d.status) {
    case "on":
      return { label: "On", variant: "success", detail: null };
    // It takes events, but slowly: it's sent to less often, never turned off for it.
    case "slow":
      return { label: "Slow", variant: "primary", detail: d.lastError };
    case "failing":
      return {
        label: "Failing",
        variant: "warning",
        detail:
          `${d.failures} failed ${d.failures === 1 ? "attempt" : "attempts"} in a row. ${d.lastError ?? ""}`.trim(),
      };
    case "paused":
      return { label: "Stopped by the server", variant: "danger", detail: d.pausedReason };
    case "off":
      return { label: "Off", variant: "secondary", detail: null };
  }
}

/** What's waiting and what was lost, in words, or null when there's nothing to say. */
export function queueNote(d: Destination): string | null {
  const parts: string[] = [];
  if (d.queued > 0) {
    parts.push(`${d.queued} ${d.queued === 1 ? "event" : "events"} waiting`);
  }
  if (d.dropped > 0) {
    parts.push(
      `${d.dropped} never sent (the queue was full or they waited three days); they're still in the event log`,
    );
  }
  return parts.length === 0 ? null : parts.join(". ");
}

/** What the signing secret callout shows a receiver's developer. */
export const SIGNING_HELP =
  'Each request carries webhook-id, webhook-timestamp, and webhook-signature headers, the Standard Webhooks way: the signature is v1, then the base64 HMAC-SHA256 of "<id>.<timestamp>.<body>" keyed with this secret\'s bytes after whsec_. Reject old timestamps, and use the id to drop repeats: an event can arrive twice.';
