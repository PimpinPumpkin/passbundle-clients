import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { ChromeCsvImporter } from "../../importers/chrome-csv-importer";
import { ImportResult } from "../../models/import-result";

import {
  browsersFor,
  deleteSteps,
  detectBrowser,
  detectComputer,
  guideFor,
  prepareImport,
} from "./browser-import";

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:144.0) Gecko/20100101 Firefox/144.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

function login(name: string, uri: string, username: string, password: string): CipherView {
  const cipher = new CipherView();
  cipher.type = CipherType.Login;
  cipher.name = name;
  cipher.login = new LoginView();
  cipher.login.username = username;
  cipher.login.password = password;
  const loginUri = new LoginUriView();
  loginUri.uri = uri;
  cipher.login.uris = [loginUri];
  return cipher;
}

function parsed(...ciphers: CipherView[]): ImportResult {
  const result = new ImportResult();
  result.success = true;
  result.ciphers = ciphers;
  return result;
}

describe("Guided browser import", () => {
  it("knows the browser and the computer", () => {
    expect(detectBrowser(UA.chromeWindows)).toBe("chrome");
    expect(detectBrowser(UA.edgeWindows)).toBe("edge");
    expect(detectBrowser(UA.firefoxMac)).toBe("firefox");
    expect(detectBrowser(UA.safariMac)).toBe("safari");
    expect(detectBrowser(UA.chromeMac, ["Chromium", "Brave", "Not A Brand"])).toBe("brave");
    expect(detectBrowser(UA.chromeWindows.replace("Chrome/", "HeadlessChrome/"))).toBe("chrome");
    expect(detectComputer(UA.edgeWindows)).toBe("windows");
    expect(detectComputer(UA.safariMac)).toBe("mac");
    expect(detectComputer("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });

  it("offers Safari only on a Mac, and each browser's own importer and steps", () => {
    expect(browsersFor("windows")).not.toContain("safari");
    expect(browsersFor("mac")).toContain("safari");
    for (const id of browsersFor("mac")) {
      const guide = guideFor(id, "mac");
      expect(guide.id).toBe(id);
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.steps.join(" ")).toContain(guide.fileName);
    }
    expect(guideFor("edge", "windows").format).toBe("edgecsv");
    expect(guideFor("edge", "windows").steps.join(" ")).toContain("Windows Hello");
    expect(guideFor("chrome", "mac").steps.join(" ")).toContain("Touch ID");
  });

  it("says how to get rid of the export on each computer", () => {
    expect(deleteSteps("logins.csv", "mac")).toContain("empty the Trash");
    expect(deleteSteps("logins.csv", "windows")).toContain("Shift+Delete");
  });

  it("leaves out what's already in the vault and repeats, skips empty passwords, and sets aside different passwords to check", () => {
    const vault = [
      login("Bank", "https://bank.example.com/login", "ana@example.com", "same-password"),
      login("Mail", "https://mail.example.com", "ana", "old-password"),
    ];
    const prepared = prepareImport(
      parsed(
        // Already there, whatever the path or the username's case.
        login("bank.example.com", "https://bank.example.com/", "Ana@Example.com", "same-password"),
        // A different password for a login the person has.
        login("mail.example.com", "https://mail.example.com/inbox", "ana", "new-password"),
        // New, then the same again in the file.
        login("shop.example.com", "https://shop.example.com", "ana", "shop-password"),
        login("shop.example.com", "https://shop.example.com", "ana", "shop-password"),
        // No password: nothing to sign in with.
        login("blank.example.com", "https://blank.example.com", "ana", ""),
      ),
      vault,
      "Check these: from Chrome",
    );
    expect(prepared).toMatchObject({ added: 1, alreadyThere: 2, toCheck: 1, empty: 1 });
    expect(prepared.result.ciphers.map((c) => c.login.password)).toEqual([
      "new-password",
      "shop-password",
    ]);
    expect(prepared.result.folders.map((f) => f.name)).toEqual(["Check these: from Chrome"]);
    expect(prepared.result.folderRelationships).toEqual([[0, 0]]);
  });

  it("works on a real Chrome export, read by upstream's importer", async () => {
    const csv = [
      "name,url,username,password,note",
      "bank.example.com,https://bank.example.com/,ana@example.com,same-password,",
      "news.example.com,https://news.example.com/,ana,news-password,",
    ].join("\n");
    const result = await new ChromeCsvImporter().parse(csv);
    const vault = [login("Bank", "https://bank.example.com", "ana@example.com", "same-password")];
    const prepared = prepareImport(result, vault, "Check these: from Chrome");
    expect(prepared).toMatchObject({ added: 1, alreadyThere: 1, toCheck: 0 });
    expect(prepared.result.ciphers[0].login.uris[0].uri).toBe("https://news.example.com/");
  });
});
