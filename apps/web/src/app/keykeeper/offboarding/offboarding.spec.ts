import { MspClient, MspRemoval, MspStaffMember } from "@bitwarden/admin-console/common";

import {
  clientRemovedLine,
  describeMspRemoval,
  inWords,
  removedByClientLine,
  replaceTokenPrompt,
} from "./offboarding";

const removal = (fields: Partial<MspRemoval> = {}): MspRemoval => ({
  msp: { id: "msp-1", name: "Northwind IT" },
  peopleRemoved: 2,
  scriptTokensRevoked: [],
  provisioningTokenRevoked: null,
  eventDestinationsDeleted: [],
  staffSealsDeleted: 0,
  installCommandRemoved: true,
  singleSignOn: null,
  ...fields,
});

describe("Offboarding words", () => {
  it("lists in words", () => {
    expect(inWords(["a"])).toBe("a");
    expect(inWords(["a", "b"])).toBe("a and b");
    expect(inWords(["a", "b", "c"])).toBe("a, b, and c");
  });

  it("say what removing an MSP took out", () => {
    const said = describeMspRemoval(
      removal({
        scriptTokensRevoked: [
          { id: "t1", name: "RMM deploy", createdBy: "mia@northwind.test" },
          { id: "t2", name: "Backup", createdBy: null },
        ],
        provisioningTokenRevoked: { createdBy: "mia@northwind.test" },
        eventDestinationsDeleted: [{ id: "d1", name: "SOC" }],
        staffSealsDeleted: 3,
      }),
    );
    expect(said.people).toBe("2 people from Northwind IT lost access to this organization.");
    expect(said.removed).toEqual([
      "Script tokens they made, now revoked: RMM deploy and Backup. Make new ones on the Settings page if your scripts still need them.",
      "The provisioning token mia@northwind.test made, now revoked. Microsoft Entra ID stops updating your members until you make a new one on the Provisioning page.",
      "Event destinations they set up, now deleted: SOC.",
      "What let your apps confirm their staff on their own.",
    ]);
    expect(said.installCommand).toMatch(/^Northwind IT's install command stopped working/);
    expect(said.singleSignOn).toBeNull();
  });

  it("point the owner to single sign-on, saying who last changed it", () => {
    const sso = (updatedByProvider: boolean) =>
      describeMspRemoval(
        removal({
          peopleRemoved: 1,
          singleSignOn: {
            enabled: true,
            updatedBy: "mia@northwind.test",
            updatedByProvider,
            updatedAt: "2026-10-27T00:00:00Z",
          },
        }),
      );
    expect(sso(true).people).toBe("1 person from Northwind IT lost access to this organization.");
    expect(sso(true).singleSignOn).toBe(
      "Review single sign-on on the Settings page: it's on, and mia@northwind.test, from Northwind IT, last changed it.",
    );
    expect(sso(false).singleSignOn).toBe(
      "Review single sign-on on the Settings page: it's on, and mia@northwind.test last changed it.",
    );
  });

  it("name the clients that took someone off the MSP's staff", () => {
    const clients = [
      { id: "dental", name: "Acme Dental" },
      { id: "law", name: "Lakeside Law" },
    ];
    const person = (removedByClient: MspStaffMember["removedByClient"]) =>
      ({
        userId: "u",
        email: "tess@northwind.test",
        name: null,
        role: "technician",
        access: null,
        removedByClient,
      }) as MspStaffMember;
    expect(removedByClientLine(person([]), clients)).toBeNull();
    expect(removedByClientLine(person(undefined), clients)).toBeNull();
    expect(
      removedByClientLine(
        person([
          { organizationId: "dental", revoked: false, at: "" },
          { organizationId: "law", revoked: true, at: "" },
        ]),
        clients,
      ),
    ).toBe(
      "Removed by the client in Acme Dental; revoked by the client in Lakeside Law. Your changes don't add them back there; only the client can.",
    );
    expect(
      removedByClientLine(person([{ organizationId: "law", revoked: true, at: "" }]), clients),
    ).toBe(
      "Revoked by the client in Lakeside Law. Your changes don't add them back there; only the client can.",
    );
  });

  it("say on a client's row whom it took out", () => {
    const client = (removedByClient: MspClient["removedByClient"]) =>
      ({ id: "dental", name: "Acme Dental", removedByClient }) as MspClient;
    expect(clientRemovedLine(client(undefined))).toBeNull();
    expect(
      clientRemovedLine(
        client([
          { userId: "1", email: "tess@northwind.test", revoked: false, at: "" },
          { userId: "2", email: "mia@northwind.test", revoked: true, at: "" },
        ]),
      ),
    ).toBe("The client removed tess@northwind.test and revoked mia@northwind.test");
  });

  it("offer to replace an install command only after removals", () => {
    expect(replaceTokenPrompt(undefined)).toBeNull();
    expect(replaceTokenPrompt(0)).toBeNull();
    expect(replaceTokenPrompt(1)).toMatch(
      /^1 person was removed since the install command was made\./,
    );
    expect(replaceTokenPrompt(2, "Northwind IT")).toMatch(
      /^2 people were removed .* Northwind IT manages it: ask them to replace the token\.$/,
    );
  });
});
