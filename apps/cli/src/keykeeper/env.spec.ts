// Keykeeper: see env.ts.
import { applyBrandEnvironment, SCRIPT_VARIABLES } from "./env";
import { scriptTokenVariable } from "./script-access";

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

  it("leaves a script token's variable as it is, copied to no name upstream's code reads", () => {
    const brand = {
      name: "PassBundle",
      command: "passbundle",
      envPrefix: "PASSBUNDLE_",
      version: "",
      releases: "",
      server: "",
    };
    // `script get` reads PASSBUNDLE_TOKEN, the PowerShell module's name.
    const variable = scriptTokenVariable(brand);
    expect(variable).toBe("PASSBUNDLE_TOKEN");
    expect(SCRIPT_VARIABLES).not.toContain("TOKEN");
    const env: NodeJS.ProcessEnv = { [variable]: "pbs1_token", PATH: "/usr/bin" };
    applyBrandEnvironment(env, "PASSBUNDLE_");
    // Nothing new: no BW_TOKEN, nor any other name, for upstream's code to pick up.
    expect(env).toEqual({ PASSBUNDLE_TOKEN: "pbs1_token", PATH: "/usr/bin" });
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
