import { reloadRefusal } from "./reload-setting.component";

describe("Stay unlocked when I reload: what a policy says", () => {
  it("leaves it to the person under no policy, a longest wait, or when the computer locks", () => {
    expect(reloadRefusal(null)).toBeNull();
    expect(reloadRefusal({ type: "custom", minutes: 30 })).toBeNull();
    expect(reloadRefusal({ type: "onSystemLock", minutes: null, webMinutes: 5 } as any)).toBeNull();
    expect(reloadRefusal({ type: "custom", minutes: 30, webReload: true })).toBeNull();
  });

  it("says why a policy turns it off", () => {
    expect(reloadRefusal({ type: "custom", minutes: 30, webReload: false })).toBe(
      "Your organization turned this off: every reload asks for your master password.",
    );
    expect(reloadRefusal({ type: "immediately", minutes: 0 })).toBe(
      "Your organization locks the vault at every reload.",
    );
    expect(reloadRefusal({ type: "onAppRestart", minutes: 0 })).toBe(
      "Your organization locks the vault at every reload.",
    );
    expect(reloadRefusal({ type: "custom", minutes: 30, action: "logOut" })).toBe(
      "Your organization signs you out when the vault locks, so a reload signs you out.",
    );
  });
});
