import { seesMspActivity, Viewer } from "./client-msp-activity";

const viewer = (fields: Partial<Viewer>): Viewer => ({
  isOwner: false,
  isAdmin: false,
  organizationUserId: "member-1",
  keykeeperFromMsp: false,
  ...fields,
});

describe("Who sees what the MSP did on a client's Members page", () => {
  it("the client's own owners and admins", () => {
    expect(seesMspActivity(viewer({ isOwner: true, isAdmin: true }), ["staff-1"])).toBe(true);
    expect(seesMspActivity(viewer({ isAdmin: true }), ["staff-1"])).toBe(true);
  });

  it("never the MSP's own people, whether sync says so or the MSP's list does", () => {
    expect(
      seesMspActivity(viewer({ isOwner: true, isAdmin: true, keykeeperFromMsp: true }), []),
    ).toBe(false);
    expect(
      seesMspActivity(viewer({ isAdmin: true, organizationUserId: "staff-1" }), ["staff-1"]),
    ).toBe(false);
  });

  it("never a custom role or a member, whom the server refuses", () => {
    expect(seesMspActivity(viewer({}), [])).toBe(false);
  });
});
