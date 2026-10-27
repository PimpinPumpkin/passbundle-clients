import { ownerPlaces } from "./folders-by-owner";

describe("ownerPlaces", () => {
  const input = {
    personalLabel: "Personal",
    noFolderLabel: "No folder",
    folders: [
      { id: "f-work", name: "Work" },
      { id: "f-clients", name: "Work/Clients" },
      { id: "f-home", name: "Home" },
      { id: "f-orphan", name: "Archive/2025" },
    ],
    organizations: [
      { id: "o-lake", name: "Lakeside Clinic" },
      { id: "o-acme", name: "Acme Dental" },
    ],
    collections: [
      { id: "c-everyone", name: "Everyone", organizationId: "o-lake" },
      { id: "c-admins", name: "Admins", organizationId: "o-lake" },
      { id: "c-front", name: "Front desk", organizationId: "o-acme" },
      { id: "c-front-pcs", name: "Front desk/PCs", organizationId: "o-acme" },
    ],
  };

  it("lists Personal and its folders, then each organization and its shared folders, by name", () => {
    expect(ownerPlaces(input).map((p) => [p.key, p.label, p.depth])).toEqual([
      ["personal", "Personal", 0],
      ["folder:f-orphan", "Archive/2025", 1],
      ["folder:f-home", "Home", 1],
      ["folder:f-work", "Work", 1],
      ["folder:f-clients", "Clients", 2],
      ["folder:none", "No folder", 1],
      ["org:o-acme", "Acme Dental", 0],
      ["shared:c-front", "Front desk", 1],
      ["shared:c-front-pcs", "PCs", 2],
      ["org:o-lake", "Lakeside Clinic", 0],
      ["shared:c-admins", "Admins", 1],
      ["shared:c-everyone", "Everyone", 1],
    ]);
  });

  it("says which owner and folder each entry is", () => {
    const places = ownerPlaces(input);
    expect(places.find((p) => p.key === "folder:none")).toMatchObject({
      kind: "folder",
      folderId: null,
    });
    expect(places.find((p) => p.key === "shared:c-everyone")).toMatchObject({
      kind: "sharedFolder",
      organizationId: "o-lake",
      collectionId: "c-everyone",
    });
    expect(places.find((p) => p.key === "org:o-acme")).toMatchObject({
      kind: "organization",
      organizationId: "o-acme",
    });
  });

  it("shows No folder only next to real folders", () => {
    const places = ownerPlaces({ ...input, folders: [] });
    expect(places.some((p) => p.key === "folder:none")).toBe(false);
    expect(places[0].key).toBe("personal");
  });

  it("shows an organization even when the person reaches none of its shared folders", () => {
    const places = ownerPlaces({ ...input, collections: [] });
    expect(places.filter((p) => p.kind === "organization").map((p) => p.label)).toEqual([
      "Acme Dental",
      "Lakeside Clinic",
    ]);
  });
});
