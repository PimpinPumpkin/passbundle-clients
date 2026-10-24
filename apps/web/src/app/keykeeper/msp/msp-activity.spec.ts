import { describeEvent, MspEvent } from "./msp-activity";

const event = (fields: Partial<MspEvent>): MspEvent => ({
  id: "1",
  date: "2026-10-16T09:30:00.000Z",
  event: "",
  actorEmail: "ana@northwind.test",
  organizationId: "org-1",
  organizationName: "Acme Dental",
  targetEmail: "ben@northwind.test",
  detail: null,
  ip: "127.0.0.1",
  ...fields,
});

describe("MSP activity sentences", () => {
  it.each([
    [
      { event: "event_stream_added", detail: "SOC (webhook: https://siem.example/…)" },
      "ana@northwind.test started sending the MSP's events to SOC (webhook: https://siem.example/…)",
    ],
    [
      { event: "event_stream_removed", detail: "SOC (syslog: siem.example:6514)" },
      "ana@northwind.test stopped sending the MSP's events to SOC (syslog: siem.example:6514)",
    ],
    [
      { event: "event_stream_paused", actorEmail: null, detail: "SOC: It answered 410 Gone" },
      "The server stopped sending the MSP's events to SOC: It answered 410 Gone",
    ],
    [{ event: "msp_created", detail: "Northwind IT" }, "ana@northwind.test set up Northwind IT"],
    [
      { event: "client_created", detail: "Default policies" },
      "ana@northwind.test added the client Acme Dental with the default policies",
    ],
    [
      { event: "client_created", detail: "Business defaults" },
      "ana@northwind.test added the client Acme Dental with the default policies",
    ],
    [
      {
        event: "default_policy_changed",
        detail: "Require two-step login to on: 3 clients changed, 1 client kept its own setting",
      },
      "ana@northwind.test set the default Require two-step login to on: 3 clients changed, 1 client kept its own setting",
    ],
    [
      { event: "client_policy_default", detail: "Master password requirements" },
      "ana@northwind.test put Acme Dental back on the default Master password requirements",
    ],
    [
      { event: "joining_default_set", detail: "confirmed automatically; invitations last 2 hours" },
      "ana@northwind.test set how people join clients: confirmed automatically; invitations last 2 hours",
    ],
    [
      { event: "client_joining_set", detail: "approved by an admin; invitations last 5 days" },
      "ana@northwind.test set how people join Acme Dental: approved by an admin; invitations last 5 days",
    ],
    [
      { event: "client_joining_default" },
      "ana@northwind.test put Acme Dental back on the joining default",
    ],
    [
      { event: "client_created", detail: "No defaults" },
      "ana@northwind.test added the client Acme Dental",
    ],
    [
      { event: "staff_added", detail: "technician" },
      "ana@northwind.test added ben@northwind.test as a technician",
    ],
    [
      { event: "staff_role_changed", detail: "admin" },
      "ana@northwind.test made ben@northwind.test an admin",
    ],
    [
      { event: "staff_removed" },
      "ana@northwind.test removed ben@northwind.test from the MSP and every client",
    ],
    [
      { event: "install_token_replaced" },
      "ana@northwind.test replaced the install token for Acme Dental",
    ],
    [
      { event: "joined_with_install_command", actorEmail: "ben@northwind.test" },
      "ben@northwind.test joined Acme Dental with the install command",
    ],
    [
      { event: "install_domains_set", detail: "acme.test branch.acme.test" },
      "ana@northwind.test limited Acme Dental's install command to acme.test, branch.acme.test accounts",
    ],
    [
      { event: "install_domains_set", detail: "" },
      "ana@northwind.test let anyone with Acme Dental's install command join",
    ],
    [
      { event: "member_confirmed" },
      "ana@northwind.test confirmed ben@northwind.test in Acme Dental",
    ],
    [
      { event: "client_removed_msp", actorEmail: "owner@acme.test" },
      "Acme Dental removed this MSP (owner@acme.test)",
    ],
    [
      { event: "script_token_created", detail: "Join domain: 2 items" },
      'ana@northwind.test made the script token "Join domain" for Acme Dental (2 items)',
    ],
    [
      { event: "script_token_created", detail: "Backup: nightly: 1 item" },
      'ana@northwind.test made the script token "Backup: nightly" for Acme Dental (1 item)',
    ],
    [
      { event: "script_token_revoked", detail: "Join domain" },
      'ana@northwind.test revoked the script token "Join domain" for Acme Dental',
    ],
    [
      {
        event: "script_token_new_address",
        actorEmail: null,
        detail: "Join domain",
        ip: "203.0.113.7",
      },
      'The script token "Join domain" for Acme Dental was used from a new address, 203.0.113.7',
    ],
    [
      { event: "provisioning_token_created" },
      "ana@northwind.test made a provisioning token for Acme Dental",
    ],
    [
      { event: "provisioning_token_replaced" },
      "ana@northwind.test replaced Acme Dental's provisioning token",
    ],
    [
      { event: "provisioning_token_revoked" },
      "ana@northwind.test revoked Acme Dental's provisioning token",
    ],
    [
      { event: "provisioning_let_in", detail: "3 people" },
      "ana@northwind.test let in 3 people Microsoft Entra ID added to Acme Dental",
    ],
    [
      { event: "staff_invited", detail: "admin" },
      "ana@northwind.test invited ben@northwind.test to join as an admin",
    ],
    [
      {
        event: "staff_access_changed",
        detail: "Acme Dental, custom role (manage users), no vault items, no install commands",
      },
      "ana@northwind.test set ben@northwind.test's access: Acme Dental, custom role (manage users), no vault items, no install commands",
    ],
    [{ event: "something_new" }, "something_new by ana@northwind.test"],
  ])("%j reads as %s", (fields, sentence) => {
    expect(describeEvent(event(fields))).toBe(sentence);
  });

  it("still reads when names are gone", () => {
    expect(
      describeEvent(
        event({
          event: "member_confirmed",
          actorEmail: null,
          organizationName: null,
          targetEmail: null,
        }),
      ),
    ).toBe("Someone confirmed someone in a client");
  });

  it("names templates the person can see, and calls others a template", () => {
    const names = (id: string) => (id === "4f6c-fw" ? "Firewall" : undefined);
    expect(
      describeEvent(event({ event: "template_added", detail: "4f6c-fw:every client" }), names),
    ).toBe("ana@northwind.test added the template Firewall for every client");
    expect(
      describeEvent(event({ event: "template_changed", detail: "4f6c-fw:2 clients" }), names),
    ).toBe("ana@northwind.test changed which clients get Firewall: 2 clients");
    expect(
      describeEvent(event({ event: "template_sent", detail: "4f6c-fw:1 client" }), names),
    ).toBe("Firewall was applied to Acme Dental (by ana@northwind.test)");
    expect(
      describeEvent(
        event({ event: "template_sent", detail: "4f6c-fw:3 clients", organizationName: null }),
        names,
      ),
    ).toBe("Firewall was applied to 3 clients (by ana@northwind.test)");
    expect(describeEvent(event({ event: "template_stopped", detail: "other-id" }), names)).toBe(
      "ana@northwind.test removed a template",
    );
  });
});
