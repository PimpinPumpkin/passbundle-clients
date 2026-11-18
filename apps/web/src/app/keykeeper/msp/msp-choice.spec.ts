import { MspSummary } from "@bitwarden/admin-console/common";

import { chosenMsp, mspChoiceLabel, rememberedMsp, rememberMsp } from "./msp-choice";

const northwind: MspSummary = { id: "msp-1", name: "Northwind IT", role: "admin" };
const contoso: MspSummary = { id: "msp-2", name: "Contoso IT", role: "technician" };

/** A Storage that keeps values in a map, or throws on every call. */
function storage(throws = false): Storage {
  const values = new Map<string, string>();
  const fail = () => {
    throw new Error("The operation is insecure.");
  };
  return {
    getItem: (key: string) => (throws ? fail() : (values.get(key) ?? null)),
    setItem: (key: string, value: string) => (throws ? fail() : void values.set(key, value)),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  };
}

describe("Choosing between several MSPs", () => {
  it("shows the MSP remembered in this browser while the person is still on its staff, otherwise the first", () => {
    expect(chosenMsp([northwind, contoso], "msp-2")).toBe(contoso);
    expect(chosenMsp([northwind, contoso], null)).toBe(northwind);
    // They left that MSP's staff since.
    expect(chosenMsp([northwind], "msp-2")).toBe(northwind);
    expect(chosenMsp([], "msp-2")).toBeNull();
  });

  it("remembers the choice per account", () => {
    const kept = storage();
    rememberMsp(kept, "user-1", "msp-2");
    expect(rememberedMsp(kept, "user-1")).toBe("msp-2");
    expect(rememberedMsp(kept, "user-2")).toBeNull();
  });

  it("remembers nothing where the browser's storage refuses or is missing, and never throws", () => {
    const refusing = storage(true);
    expect(() => rememberMsp(refusing, "user-1", "msp-2")).not.toThrow();
    expect(rememberedMsp(refusing, "user-1")).toBeNull();
    expect(rememberedMsp(null, "user-1")).toBeNull();
    expect(() => rememberMsp(undefined, "user-1", "msp-2")).not.toThrow();
  });

  it("names each MSP with the person's role there", () => {
    expect(mspChoiceLabel(northwind)).toBe("Northwind IT (Admin)");
    expect(mspChoiceLabel(contoso)).toBe("Contoso IT (Technician)");
  });
});
