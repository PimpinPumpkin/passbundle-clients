// Keykeeper: the shapes of the MSP API (/api/keykeeper/msp on the server),
// shared by the web vault's MSP console and the MSP work that runs in the
// background of the web vault and the browser extension.

export type MspRole = "admin" | "technician";

/** The defaults a new client starts with. "business" is the Business preset. */
export type ClientPreset = "business" | "none";

export type MspSummary = { id: string; name: string; role: MspRole };

export type MspClient = {
  id: string;
  name: string;
  createdAt: string;
  preset: "business" | null;
  members: { confirmed: number; accepted: number; invited: number; revoked: number };
  /**
   * The caller's own membership there, if any. Status 2 is confirmed; type 0 is
   * owner and 1 admin. vaultItems: whether they see every item there.
   */
  you: { memberId: string; status: number; type: number; vaultItems?: boolean } | null;
};

/** The custom role permissions the server enforces. */
export type CustomPermissions = {
  manageUsers: boolean;
  manageResetPassword: boolean;
  managePolicies: boolean;
  accessEventLogs: boolean;
  accessImportExport: boolean;
};

/**
 * What a technician gets in the MSP's clients: every client or chosen ones,
 * admin or a custom role inside them, and whether they see install commands.
 * MSP admins are owners of every client, so they have none.
 */
export type TechnicianAccess = {
  allClients: boolean;
  /** With allClients false, the clients they reach. */
  clients: string[];
  /** A custom role in each client, or null for admin. vaultItems: every item there. */
  custom: { permissions: CustomPermissions; vaultItems: boolean } | null;
  installCommands: boolean;
};

export type MspStaffMember = {
  userId: string;
  email: string;
  name: string | null;
  role: MspRole;
  /** A technician's access. Only MSP admins see it. */
  access: TechnicianAccess | null;
};

export type MspInvite = {
  id: string;
  email: string;
  role: MspRole;
  /** The access a technician gets on joining. Only MSP admins see it. */
  access: TechnicianAccess | null;
  createdAt: string;
};

export type MspDetails = MspSummary & {
  /** A technician's own access; null for MSP admins. Older servers leave it out. */
  access?: TechnicianAccess | null;
  staff: MspStaffMember[];
  invites: MspInvite[];
  /** For a technician limited to chosen clients, just those. */
  clients: MspClient[];
};

/**
 * Adding staff. Current servers always invite, so joining a staff is the
 * person's to accept; older ones added someone with an account at once.
 */
export type AddStaffResult =
  | { invited: false; email: string; role: MspRole }
  | {
      invited: true;
      inviteId: string;
      email: string;
      role: MspRole;
      inviteUrl: string;
      emailed: boolean;
    };

export type InvitationInfo = {
  mspName: string;
  role: MspRole;
  email: string;
  invitedBy: string;
  forYou: boolean;
};

export type ClientEnrollment = {
  token: string | null;
  createdAt: string | null;
  joins: number;
  /** Only accounts at these email domains may join with the command; none means anyone. */
  domains: string[];
};

export type ClientMsp = {
  msp: { id: string; name: string } | null;
  staff: { memberId: string; email: string; name: string | null }[];
  /** Policies where the organization has its own setting rather than the MSP's default. Older servers leave it out. */
  ownPolicies?: { type: number; name: string }[];
};

/** A policy: on or off, with its options as upstream stores them. */
export type MspPolicy = { type: number; enabled: boolean; data: any };

/**
 * The MSP's default policies, and for each client the caller reaches, the
 * policies where it has its own setting. `types` are the policies this server
 * offers, in order.
 */
export type MspPolicies = {
  types: number[];
  defaults: MspPolicy[];
  clients: { id: string; name: string; own: MspPolicy[] }[];
};

type NamedClient = { id: string; name: string };

/** What changing a default did: clients that changed, kept their own setting, or refused it. */
export type DefaultPolicyResult = {
  changed: NamedClient[];
  kept: NamedClient[];
  refused: (NamedClient & { error: string })[];
};

/**
 * Item templates the MSP sends: the source item, and every client or chosen
 * ones. Copies and Templates collections cover the clients the caller reaches.
 * The server never sees what's in a template.
 */
export type MspTemplates = {
  templates: {
    templateId: string;
    sourceCipherId: string;
    allClients: boolean;
    clients: string[];
    createdAt: string;
  }[];
  copies: {
    organizationId: string;
    templateId: string;
    cipherId: string;
    sourceRevision: string;
  }[];
  /** Each client's Templates collection, or null before its first template. */
  collections: Record<string, string | null>;
};

export type TemplateCopy = { organizationId: string; cipherId: string; sourceRevision: string };

/** A membership waiting for its org key in an organization the caller can confirm in. */
export type PendingMember = {
  organizationId: string;
  memberId: string;
  email: string;
  publicKey: string;
  /** Whether the organization confirms automatically, or wants an admin to approve. */
  autoConfirm: boolean;
};

/** How people join an organization. See DESIGN.md, "Joining". */
export type Joining = { autoConfirm: boolean; inviteHours: number };

/** An organization's setting, where it comes from, and what its default would be. */
export type OrgJoining = Joining & {
  source: "own" | "msp" | "server";
  mspName?: string;
  default: Joining;
};

/** An MSP's default, and the clients with their own setting. */
export type MspJoining = {
  default: Joining;
  ownSettings: (Joining & { organizationId: string; name: string })[];
};
