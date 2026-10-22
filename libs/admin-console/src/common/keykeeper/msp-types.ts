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
  /** The command's join secret, encrypted with the organization's key. Older servers leave it out. */
  secret?: string | null;
};

/** One of the MSP's people in a client, and what they can do there. */
export type ClientMspStaff = {
  memberId: string;
  email: string;
  name: string | null;
  /** Older servers leave out the role, its permissions, and vault items. */
  role?: "owner" | "admin" | "custom" | "member";
  /** A custom role's permissions, by upstream's names (manageUsers and the rest). */
  permissions?: string[];
  /** Whether they see every vault item in the organization. */
  vaultItems?: boolean;
};

export type ClientMsp = {
  msp: { id: string; name: string } | null;
  staff: ClientMspStaff[];
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
  userId: string;
  email: string;
  publicKey: string;
  /** Whether the organization confirms automatically, or wants an admin to approve. */
  autoConfirm: boolean;
  /**
   * Whether the organization requires two-step login and they haven't turned
   * it on, so confirming them fails until they do. Apps don't try, and say so.
   */
  needsTwoStep?: boolean;
  /** An MSP staff member's place in a client. */
  fromMsp?: boolean;
  /**
   * What lets an app let them in on its own without trusting the server: the
   * organization's sealed joining setting, and whatever vouches for the
   * person. Older servers leave these out, and then an admin approves. See
   * DESIGN.md, "Joins a hacked server can't forge".
   */
  joining?: { autoConfirm: boolean; domains: string[]; seal: string | null };
  inviteSeal?: string | null;
  staffSeal?: string | null;
  joinProof?: string | null;
  /** The install command's join secret, encrypted with the organization's key. */
  enrollmentSecret?: string | null;
};

/** How people join an organization. See DESIGN.md, "Joining". */
export type Joining = { autoConfirm: boolean; inviteHours: number };

/** An organization's setting, where it comes from, and what its default would be. */
export type OrgJoining = Joining & {
  source: "own" | "msp" | "server";
  mspName?: string;
  default: Joining;
  /** The email domains and the seal over them with the setting. Older servers leave these out. */
  domains?: string[];
  seal?: string | null;
};

/** An MSP's default, and the clients with their own setting. */
export type MspJoining = {
  default: Joining;
  ownSettings: (Joining & { organizationId: string; name: string })[];
  /** For MSP admins: the clients that follow the default, with what's resealed when it changes. */
  following?: { organizationId: string; domains: string[]; seal: string | null }[];
};

/** A site fix: a site, how to recognize a field there, and which kind of value goes in it. See DESIGN.md, "Site fixes (opt-in)". */
export type SiteFixView = {
  host: string;
  field: { id: string; name: string; label: string };
  fill: "username" | "password" | "totp" | "never";
};

/** An MSP's site rules, and the fixes its staff shared. */
export type MspSiteFixes = {
  rules: (SiteFixView & { id: string; createdAt: string })[];
  shared: (SiteFixView & { id: string; reportedBy: string; reportedAt: string })[];
};

/** An organization that can't confirm the person until they turn on two-step login. */
export type TwoStepNeeded = { organizationId: string; name: string };

/** A script token as its organization's admins see it (docs/script-access.md). */
export type ScriptTokenView = {
  id: string;
  organizationId: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  networks: string[];
  /** The token key, sealed with the organization key. */
  sealedKey: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  grants: {
    itemId: string;
    revision: string;
    sealedSpec: string;
    itemDeleted: boolean;
    upToDate: boolean;
  }[];
};

/** A grant as an app sends it: the copy, the item revision it was made from, and its sealed spec. */
export type ScriptGrantData = {
  itemId: string;
  copy: string;
  revision: string;
  sealedSpec: string;
};

export type NewScriptToken = {
  id: string;
  name: string;
  expiresAt: string;
  networks: string[];
  authHash: string;
  sealedKey: string;
  grants: ScriptGrantData[];
};

export type ScriptReadView = {
  itemId: string | null;
  at: string;
  ip: string;
  allowed: boolean;
  reason: string;
};

/** A grant whose copy is behind its item, with what an app needs to refresh it. */
export type StaleScriptGrant = {
  organizationId: string;
  tokenId: string;
  itemId: string;
  revision: string;
  sealedKey: string;
  sealedSpec: string;
};
