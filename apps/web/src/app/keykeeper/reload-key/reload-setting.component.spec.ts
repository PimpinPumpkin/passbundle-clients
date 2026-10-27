import { reloadNote, reloadRefusal } from "./reload-setting.component";

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

describe("Stay unlocked when I reload: why it's off", () => {
  it("says nothing when it's the person's own choice", () => {
    expect(reloadNote({ on: true }, null)).toBeNull();
    expect(reloadNote({ on: false }, null)).toBeNull();
  });

  it("says a timeout of On browser refresh keeps it off", () => {
    expect(reloadNote({ on: false, because: "onBrowserRefresh" }, null)).toBe(
      "Off while your timeout is On browser refresh, which locks at every reload.",
    );
    expect(
      reloadNote({ on: false, because: "onBrowserRefresh" }, {
        type: "onSystemLock",
        minutes: null,
        webMinutes: 30,
      } as any),
    ).toBe(
      "Off while your own timeout is On browser refresh, which locks at every reload. Your " +
        "organization's policy shows 30 minutes here instead; choose another timeout above to " +
        "stay unlocked when you reload.",
    );
  });

  it("says a policy turned it off when it replaced On browser refresh", () => {
    expect(
      reloadNote(
        { on: false, because: "onBrowserRefreshReplaced" },
        {
          type: "custom",
          minutes: 30,
        },
      ),
    ).toBe(
      "Turned off because your organization's policy replaced your timeout of On browser " +
        "refresh, which locked at every reload. Turn it on to stay unlocked when you reload.",
    );
  });
});
