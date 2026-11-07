import { UriMatchStrategy } from "../../models/domain/domain-service";

import { firstOpenAndFillUrl, openAndFillUrl } from "./open-and-fill";

describe("Keykeeper: which websites open and fill", () => {
  it("opens an https website as it's saved", () => {
    expect(openAndFillUrl({ uri: "https://bank.example.test/login" })).toBe(
      "https://bank.example.test/login",
    );
    expect(openAndFillUrl({ uri: "https://Bank.example.test" })).toBe("https://bank.example.test/");
  });

  it("opens a website saved without a scheme over https, not http as a plain open does", () => {
    expect(openAndFillUrl({ uri: "bank.example.test/login" })).toBe(
      "https://bank.example.test/login",
    );
  });

  it("keeps a website that says http as http", () => {
    expect(openAndFillUrl({ uri: "http://printer.example.test:8080/" })).toBe(
      "http://printer.example.test:8080/",
    );
  });

  it("only opens a website that never fills, a pattern, or one that isn't a web address", () => {
    expect(
      openAndFillUrl({ uri: "https://bank.example.test", match: UriMatchStrategy.Never }),
    ).toBeNull();
    expect(
      openAndFillUrl({ uri: "^https://bank", match: UriMatchStrategy.RegularExpression }),
    ).toBeNull();
    expect(openAndFillUrl({ uri: "ssh://server.example.test" })).toBeNull();
    expect(openAndFillUrl({ uri: "file:///etc/passwd" })).toBeNull();
    expect(openAndFillUrl({ uri: "" })).toBeNull();
    expect(openAndFillUrl({ uri: null })).toBeNull();
    expect(openAndFillUrl(undefined)).toBeNull();
  });

  it("keeps the match setting otherwise", () => {
    expect(
      openAndFillUrl({ uri: "https://bank.example.test/login", match: UriMatchStrategy.Exact }),
    ).toBe("https://bank.example.test/login");
  });

  it("takes a login's first website that opens and fills", () => {
    expect(
      firstOpenAndFillUrl([
        { uri: "ssh://server.example.test" },
        { uri: "https://www.example.test", match: UriMatchStrategy.Never },
        { uri: "https://login.example.test" },
        { uri: "https://other.example.test" },
      ]),
    ).toBe("https://login.example.test/");
    expect(firstOpenAndFillUrl([{ uri: "ssh://server.example.test" }])).toBeNull();
    expect(firstOpenAndFillUrl(undefined)).toBeNull();
  });
});
