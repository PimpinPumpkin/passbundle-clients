// Keykeeper: see env.ts.
import { applyBrandEnvironment } from "./env";

describe("applyBrandEnvironment", () => {
  it("copies the brand's variables to the names upstream's code reads", () => {
    const env: NodeJS.ProcessEnv = {
      PASSBUNDLE_SESSION: "session-key",
      PASSBUNDLE_CLIENTID: "user.1",
      PASSBUNDLE_CLIENTSECRET: "secret",
      PASSBUNDLE_NOINTERACTION: "true",
      PASSBUNDLE_APPDATA_DIR: "/srv/passbundle",
      PASSBUNDLE_DEBUG: "true",
      PATH: "/usr/bin",
    };
    applyBrandEnvironment(env, "PASSBUNDLE_");
    expect(env).toMatchObject({
      BW_SESSION: "session-key",
      BW_CLIENTID: "user.1",
      BW_CLIENTSECRET: "secret",
      BW_NOINTERACTION: "true",
      BITWARDENCLI_APPDATA_DIR: "/srv/passbundle",
      BITWARDENCLI_DEBUG: "true",
      PATH: "/usr/bin",
    });
  });

  it("ignores upstream's names from the environment, so another product's key is never used", () => {
    const env: NodeJS.ProcessEnv = {
      BW_SESSION: "their-session",
      BW_CLIENTID: "user.theirs",
      BW_CLIENTSECRET: "their-secret",
      BITWARDENCLI_APPDATA_DIR: "/home/ana/.config/Bitwarden CLI",
    };
    applyBrandEnvironment(env, "PASSBUNDLE_");
    expect(env).toEqual({});
  });

  it("drops upstream's names in any case, and leaves other variables alone", () => {
    const env: NodeJS.ProcessEnv = {
      bw_session: "theirs",
      Bw_ClientSecret: "theirs",
      BW_SERVE: "true",
      BW_PASSWORD: "a script's own name, for --passwordenv",
    };
    applyBrandEnvironment(env, "PASSBUNDLE_");
    expect(env).toEqual({ BW_PASSWORD: "a script's own name, for --passwordenv" });
  });

  it("takes the brand's value over upstream's", () => {
    const env: NodeJS.ProcessEnv = { BW_SESSION: "theirs", PASSBUNDLE_SESSION: "ours" };
    applyBrandEnvironment(env, "PASSBUNDLE_");
    expect(env.BW_SESSION).toBe("ours");
  });

  it("leaves an unbranded build's environment as upstream reads it", () => {
    const env: NodeJS.ProcessEnv = { BW_SESSION: "s", BITWARDENCLI_APPDATA_DIR: "/d" };
    applyBrandEnvironment(env, "BW_");
    expect(env).toEqual({ BW_SESSION: "s", BITWARDENCLI_APPDATA_DIR: "/d" });
  });
});
