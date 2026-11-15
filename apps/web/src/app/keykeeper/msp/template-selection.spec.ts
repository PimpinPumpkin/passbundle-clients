import {
  commonTargets,
  copiesByTemplate,
  skippedTemplatesNotice,
  skippedTemplatesResult,
  templateCount,
} from "./template-selection";

describe("selecting several templates", () => {
  describe("commonTargets", () => {
    it("is every client only when every selected template goes to every client", () => {
      expect(
        commonTargets([
          { allClients: true, clients: [] },
          { allClients: true, clients: [] },
        ]),
      ).toEqual({ allClients: true, chosen: [] });
    });

    it("is the clients all of them go to otherwise", () => {
      expect(
        commonTargets([
          { allClients: false, clients: ["acme", "baker"] },
          { allClients: false, clients: ["baker", "corner"] },
        ]),
      ).toEqual({ allClients: false, chosen: ["baker"] });
    });

    it("counts a template for every client as going to each of them", () => {
      expect(
        commonTargets([
          { allClients: true, clients: [] },
          { allClients: false, clients: ["acme", "baker"] },
        ]),
      ).toEqual({ allClients: false, chosen: ["acme", "baker"] });
    });

    it("starts with nothing ticked when they have no client in common", () => {
      expect(
        commonTargets([
          { allClients: false, clients: ["acme"] },
          { allClients: false, clients: ["baker"] },
        ]),
      ).toEqual({ allClients: false, chosen: [] });
    });

    it("is one template's own setting for one template", () => {
      expect(commonTargets([{ allClients: false, clients: ["acme"] }])).toEqual({
        allClients: false,
        chosen: ["acme"],
      });
    });

    it("has nothing to start from for an empty selection", () => {
      expect(commonTargets([])).toEqual({ allClients: false, chosen: [] });
    });
  });

  describe("copiesByTemplate", () => {
    const copies = [
      { templateId: "firewall", organizationId: "acme", cipherId: "f-acme" },
      { templateId: "firewall", organizationId: "baker", cipherId: "f-baker" },
      { templateId: "printer", organizationId: "acme", cipherId: "p-acme" },
      { templateId: "router", organizationId: "acme", cipherId: "r-acme" },
    ];
    const all = () => true;

    it("lists the copies of the selected templates only, by template", () => {
      expect(copiesByTemplate(copies, ["firewall", "printer"], all)).toEqual(
        new Map([
          ["firewall", ["f-acme", "f-baker"]],
          ["printer", ["p-acme"]],
        ]),
      );
    });

    it("leaves out copies the person can't see or that are already in the trash", () => {
      const visible = (id: string) => id !== "f-baker";

      expect(copiesByTemplate(copies, ["firewall"], visible)).toEqual(
        new Map([["firewall", ["f-acme"]]]),
      );
    });

    it("with new clients, lists only the copies in clients that no longer get it", () => {
      expect(copiesByTemplate(copies, ["firewall", "printer"], all, ["acme"])).toEqual(
        new Map([
          ["firewall", ["f-baker"]],
          ["printer", []],
        ]),
      );
    });

    it("keeps a selected template that has no copies, with none", () => {
      expect(copiesByTemplate(copies, ["unsent"], all)).toEqual(new Map([["unsent", []]]));
    });
  });

  describe("what it says", () => {
    it("counts templates in words", () => {
      expect(templateCount(1)).toBe("1 template");
      expect(templateCount(4)).toBe("4 templates");
    });

    it("says nothing about skipping when nothing is skipped", () => {
      expect(skippedTemplatesNotice(0, 3)).toBe("");
      expect(skippedTemplatesResult(0)).toBe("");
    });

    it("says how many will be skipped and why, before", () => {
      expect(skippedTemplatesNotice(1, 3)).toBe(
        "1 of the 3 templates you selected will be skipped. You can't see it, so you can't change which clients get it.",
      );
      expect(skippedTemplatesNotice(2, 5)).toBe(
        "2 of the 5 templates you selected will be skipped. You can't see them, so you can't change which clients get them.",
      );
    });

    it("says how many were skipped, after", () => {
      expect(skippedTemplatesResult(1)).toBe(" 1 template was skipped.");
      expect(skippedTemplatesResult(2)).toBe(" 2 templates were skipped.");
    });
  });
});
