import {
  Destination,
  emptyForm,
  formFor,
  queueNote,
  requestFor,
  statusView,
} from "./event-streaming";

const destination = (fields: Partial<Destination>): Destination => ({
  id: "d-1",
  name: "SOC",
  kind: "webhook",
  enabled: true,
  target: "https://siem.example/…",
  status: "on",
  pausedReason: null,
  failures: 0,
  failingSince: null,
  lastSuccessAt: null,
  lastError: null,
  lastErrorAt: null,
  queued: 0,
  dropped: 0,
  createdAt: "2026-10-23T12:00:00Z",
  updatedAt: "2026-10-23T12:00:00Z",
  ...fields,
});

describe("event streaming requests", () => {
  it("sends every setting for a new webhook, and a header only with a name", () => {
    const form = {
      ...emptyForm(),
      name: " SOC ",
      url: " https://siem.example/hook?token=abc ",
      headerName: "Authorization",
      headerValue: "Bearer x",
    };
    expect(requestFor(form, null)).toEqual({
      name: "SOC",
      kind: "webhook",
      webhook: {
        url: "https://siem.example/hook?token=abc",
        headerName: "Authorization",
        headerValue: "Bearer x",
        caCertificate: "",
      },
    });
    expect(requestFor({ ...form, headerName: "" }, null)).toMatchObject({
      webhook: { headerName: "", headerValue: undefined },
    });
  });

  it("keeps saved secrets when editing leaves them blank, and never sends the kind", () => {
    const editing = destination({
      webhook: { headerName: "Authorization", caCertificate: null },
    });
    const form = formFor(editing);
    expect(form).toMatchObject({ name: "SOC", kind: "webhook", url: "", headerValue: "" });
    const request = requestFor(form, editing);
    expect(request).toEqual({
      name: "SOC",
      webhook: {
        url: undefined,
        headerName: "Authorization",
        headerValue: undefined,
        caCertificate: "",
      },
    });
    expect(requestFor({ ...form, url: "https://new.example/" }, editing)).toMatchObject({
      webhook: { url: "https://new.example/" },
    });
  });

  it("sends syslog and Sentinel settings, keeping Sentinel's secret when blank", () => {
    const syslog = {
      ...emptyForm(),
      name: "Syslog",
      kind: "syslog" as const,
      host: "siem.example",
      format: "cef" as const,
      port: null,
    };
    expect(requestFor(syslog, null)).toEqual({
      name: "Syslog",
      kind: "syslog",
      syslog: { host: "siem.example", port: 6514, format: "cef", caCertificate: "" },
    });
    const sentinel = destination({
      kind: "sentinel",
      sentinel: {
        tenantId: "contoso.onmicrosoft.com",
        clientId: "c",
        endpoint: "https://x.westus2-1.ingest.monitor.azure.com",
        ruleId: "dcr-1",
        stream: "Custom-PassBundleEvents",
        hasClientSecret: true,
      },
    });
    expect(requestFor(formFor(sentinel), sentinel)).toEqual({
      name: "SOC",
      sentinel: {
        tenantId: "contoso.onmicrosoft.com",
        clientId: "c",
        clientSecret: undefined,
        endpoint: "https://x.westus2-1.ingest.monitor.azure.com",
        ruleId: "dcr-1",
        stream: "Custom-PassBundleEvents",
      },
    });
  });
});

describe("event streaming status", () => {
  it("says how a destination is doing and why", () => {
    expect(statusView(destination({}))).toEqual({ label: "On", variant: "success", detail: null });
    expect(
      statusView(destination({ status: "failing", failures: 2, lastError: "It answered 503" })),
    ).toEqual({
      label: "Failing",
      variant: "warning",
      detail: "2 failed attempts in a row. It answered 503",
    });
    expect(
      statusView(
        destination({ status: "paused", enabled: false, pausedReason: "It answered 410 Gone" }),
      ),
    ).toMatchObject({ variant: "danger", detail: "It answered 410 Gone" });
    expect(statusView(destination({ status: "off", enabled: false })).label).toBe("Off");
    // Slow isn't failing: it's sent to less often, and says why.
    expect(
      statusView(destination({ status: "slow", lastError: "It took 9 seconds to answer." })),
    ).toEqual({ label: "Slow", variant: "primary", detail: "It took 9 seconds to answer." });
  });

  it("notes what's waiting and what was dropped", () => {
    expect(queueNote(destination({}))).toBeNull();
    expect(queueNote(destination({ queued: 1 }))).toBe("1 event waiting");
    expect(queueNote(destination({ queued: 3, dropped: 2 }))).toBe(
      "3 events waiting. 2 never sent (the queue was full or they waited three days); they're still in the event log",
    );
  });
});
