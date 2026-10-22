import {
  describeAccess,
  describeStaffRole,
  DEFAULT_ACCESS,
  NO_PERMISSIONS,
} from "./technician-access";

const clients = [
  { id: "acme", name: "Acme Dental" },
  { id: "baker", name: "Baker Law" },
];

describe("technician access in words", () => {
  it("reads the default as every client, admin, with install commands", () => {
    expect(describeAccess(DEFAULT_ACCESS, clients)).toBe("Every client · Admin · Install commands");
  });

  it("names chosen clients in order, and a custom role with or without vault items", () => {
    const custom = {
      allClients: false,
      clients: ["baker", "acme"],
      custom: { permissions: { ...NO_PERMISSIONS, manageUsers: true }, vaultItems: false },
      installCommands: false,
    };
    expect(describeAccess(custom, clients)).toBe(
      "Acme Dental, Baker Law · Custom role · No install commands",
    );
    expect(
      describeAccess({ ...custom, custom: { ...custom.custom, vaultItems: true } }, clients),
    ).toBe("Acme Dental, Baker Law · Custom role with vault items · No install commands");
  });

  it("says when no client is chosen, and skips clients that are gone", () => {
    const access = { ...DEFAULT_ACCESS, allClients: false, clients: ["gone"] };
    expect(describeAccess(access, clients)).toBe("No clients · Admin · Install commands");
  });
});

describe("an MSP's people in a client, in words", () => {
  const t = (key: string) =>
    ({ manageUsers: "Manage users", manageAccountRecovery: "Manage account recovery" })[key] ?? key;
  const person = { memberId: "m", email: "pat@example.test", name: "Pat" };

  it("reads owners and admins as seeing every vault item", () => {
    expect(describeStaffRole({ ...person, role: "owner" }, t)).toBe("Owner, with every vault item");
    expect(describeStaffRole({ ...person, role: "admin", vaultItems: true }, t)).toBe(
      "Admin, with every vault item",
    );
  });

  it("names a custom role's permissions in the console's order, with or without vault items", () => {
    const helpdesk = {
      ...person,
      role: "custom" as const,
      permissions: ["manageResetPassword", "manageUsers"],
      vaultItems: false,
    };
    expect(describeStaffRole(helpdesk, t)).toBe(
      "Custom role (Manage users, Manage account recovery), no vault items",
    );
    expect(describeStaffRole({ ...helpdesk, vaultItems: true }, t)).toBe(
      "Custom role (Manage users, Manage account recovery), with every vault item",
    );
  });

  it("reads a regular member by their vault items, and says nothing when the server didn't", () => {
    expect(describeStaffRole({ ...person, role: "member", vaultItems: true }, t)).toBe(
      "Member, with every vault item",
    );
    expect(describeStaffRole(person, t)).toBeNull();
  });
});
