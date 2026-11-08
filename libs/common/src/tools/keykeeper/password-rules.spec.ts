import {
  combineRules,
  meetsRules,
  parsePasswordRules,
  passwordForChange,
  passwordForRules,
  passwordForSite,
  PasswordRules,
  rulesForFields,
  rulesForHost,
  secureRandomInt,
} from "./password-rules";
import { SITE_PASSWORD_RULES } from "./site-password-rules.data";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const sorted = (chars: string | null) => [...(chars ?? "")].sort().join("");

describe("parsePasswordRules", () => {
  it("reads lengths, repeats, required sets, and the allowed characters", () => {
    // americanexpress.com's entry.
    const rules = parsePasswordRules(
      "minlength: 8; maxlength: 20; max-consecutive: 4; required: lower, upper; required: digit; allowed: [%&_?#=];",
    )!;

    expect(rules.minLength).toBe(8);
    expect(rules.maxLength).toBe(20);
    expect(rules.maxConsecutive).toBe(4);
    expect(rules.required.map(sorted)).toEqual([sorted(LETTERS), "0123456789"]);
    expect(sorted(rules.allowed)).toBe(sorted(LETTERS + "0123456789%&_?#="));
  });

  it("allows only the required and allowed characters, or any printable ASCII when it names none", () => {
    expect(sorted(parsePasswordRules("required: digit; required: lower;")!.allowed)).toBe(
      sorted("0123456789abcdefghijklmnopqrstuvwxyz"),
    );
    const lengthsOnly = parsePasswordRules("minlength: 6; maxlength: 16;")!;
    expect(lengthsOnly.allowed).toHaveLength(95);
    expect(lengthsOnly.required).toEqual([]);
    expect(parsePasswordRules("allowed: unicode; minlength: 4")!.allowed).toBeNull();
  });

  it("reads custom sets the way Apple's parser does", () => {
    // A leading "-" is in the set; anywhere else it's ignored.
    expect(parsePasswordRules("required: [-@#]")!.required).toEqual(["-@#"]);
    expect(parsePasswordRules("required: [@-#]")!.required).toEqual(["@#"]);
    // "]]" at the end puts "]" in the set, and "[" and ";" inside a set are characters.
    expect(parsePasswordRules("required: [[;]]; minlength: 3")).toEqual({
      required: ["[;]"],
      allowed: "[;]",
      minLength: 3,
    });
    // admiral.com's set, with a space and a quote.
    expect(parsePasswordRules(`required: [- !"#$&'()*+,.:;<=>?@[^_\`{|}~]];`)!.required[0]).toBe(
      `- !"#$&'()*+,.:;<=>?@[^_\`{|}~]`,
    );
    // Only printable ASCII counts.
    expect(parsePasswordRules("required: [a’b]")!.required).toEqual(["ab"]);
  });

  it("special is every printable ASCII character that isn't a letter or digit", () => {
    const special = parsePasswordRules("required: special")!.required[0];
    expect(special).toHaveLength(33);
    expect(special).toContain(" ");
    expect(special).toContain("/");
    expect(special).toContain("\\");
    expect(special).not.toMatch(/[A-Za-z0-9]/);
  });

  it("takes the tightest of repeated limits", () => {
    expect(parsePasswordRules("minlength: 6; minlength: 8; maxlength: 30; maxlength: 20")).toEqual(
      expect.objectContaining({ minLength: 8, maxLength: 20 }),
    );
  });

  it.each([
    ["nothing", ""],
    ["an unknown class", "required: emoji"],
    ["an unfinished set", "required: [abc"],
    ["a length that isn't a number", "minlength: eight"],
    ["a zero length", "maxlength: 0"],
  ])("refuses %s", (_, text) => {
    expect(parsePasswordRules(text)).toBeNull();
  });

  it("reads every site's entry", () => {
    const unreadable = Object.entries(SITE_PASSWORD_RULES).filter(
      ([, text]) => parsePasswordRules(text) == null,
    );
    expect(unreadable).toEqual([]);
  });
});

describe("rulesForHost", () => {
  const table = { "bank.example": "minlength: 10;", "login.shop.example": "maxlength: 12;" };

  it("finds a site's rules from any of its subdomains, ignoring the port", () => {
    expect(rulesForHost("bank.example", table)?.minLength).toBe(10);
    expect(rulesForHost("www.BANK.example:8443", table)?.minLength).toBe(10);
    expect(rulesForHost("secure.www.bank.example", table)?.minLength).toBe(10);
  });

  it("keeps a subdomain's rules to that subdomain", () => {
    expect(rulesForHost("login.shop.example", table)?.maxLength).toBe(12);
    expect(rulesForHost("shop.example", table)).toBeNull();
  });

  it("finds nothing for other sites or a bare top-level domain", () => {
    expect(rulesForHost("example", { example: "minlength: 4" })).toBeNull();
    expect(rulesForHost("other.example", table)).toBeNull();
    expect(rulesForHost("", table)).toBeNull();
    expect(rulesForHost(null, table)).toBeNull();
  });

  it("uses the published rules by default", () => {
    expect(rulesForHost("www.chase.com")).toEqual(
      expect.objectContaining({ minLength: 8, maxLength: 32, maxConsecutive: 2 }),
    );
  });
});

describe("meetsRules", () => {
  const rules: PasswordRules = parsePasswordRules(
    "minlength: 8; maxlength: 12; max-consecutive: 2; required: upper; required: [!#]; allowed: lower;",
  )!;

  it.each([
    ["Abcdefg!", true],
    ["Abcdef!", false], // too short
    ["Abcdefghijk!x", false], // too long
    ["abcdefg!", false], // no upper
    ["Abcdefgh", false], // no symbol
    ["Abcdefg$", false], // a symbol that isn't allowed
    ["Abcdeffg!", true], // two in a row
    ["Abcdefffg!", false], // three in a row
  ])("%s: %s", (password, expected) => {
    expect(meetsRules(password, rules)).toBe(expected);
  });
});

describe("passwordForRules", () => {
  it("makes a password for every site's rules that follows them", () => {
    const failed: string[] = [];
    for (const [domain, text] of Object.entries(SITE_PASSWORD_RULES)) {
      const rules = parsePasswordRules(text)!;
      for (const preferred of [6, 14, 40]) {
        const password = passwordForRules(rules, preferred);
        if (password == null || !meetsRules(password, rules) || password.includes(" ")) {
          failed.push(`${domain} at ${preferred}: ${password}`);
        }
      }
    }
    expect(failed).toEqual([]);
  });

  it("keeps the preferred length within the site's limits", () => {
    const rules = parsePasswordRules("minlength: 8; maxlength: 16; required: digit;")!;
    expect(passwordForRules(rules, 14)).toHaveLength(14);
    expect(passwordForRules(rules, 30)).toHaveLength(16);
    expect(passwordForRules(rules, 4)).toHaveLength(8);
  });

  it("is long enough for one of each required set", () => {
    const rules = parsePasswordRules("required: upper; required: lower; required: digit")!;
    expect(passwordForRules(rules, 1)).toHaveLength(3);
  });

  it("never uses a space, and gives up on rules that need one", () => {
    expect(
      passwordForRules(parsePasswordRules("required: [ ab]; maxlength: 30")!, 30),
    ).not.toContain(" ");
    expect(passwordForRules(parsePasswordRules("required: [ ]")!, 10)).toBeNull();
  });

  it("gives up on rules no password can meet", () => {
    expect(
      passwordForRules(
        parsePasswordRules("maxlength: 2; required: upper; required: lower; required: digit")!,
        8,
      ),
    ).toBeNull();
  });

  it("uses the random source it's given", () => {
    const rules = parsePasswordRules("required: [ab]; allowed: [ab]; minlength: 4; maxlength: 4")!;
    // A source that always answers 0 picks the first character every time.
    expect(passwordForRules(rules, 4, () => 0)).toBe("aaaa");
  });
});

describe("passwordForSite", () => {
  it("keeps the generated password when the site has no rules or accepts it", () => {
    expect(passwordForSite("abc^&*DEF123", "nowhere.example.test")).toBe("abc^&*DEF123");
    // chase.com: 8 to 32, lower or upper, a digit, and one of !#$%+/=@~.
    expect(passwordForSite("Abcdefgh1234!xyz", "www.chase.com")).toBe("Abcdefgh1234!xyz");
  });

  it("makes one the site accepts, at the same length, when the generated one isn't", () => {
    const generated = "Abc^^^def&*123xy"; // three in a row, and symbols Chase doesn't allow
    const password = passwordForSite(generated, "secure.chase.com");

    expect(password).not.toBe(generated);
    expect(password).toHaveLength(generated.length);
    expect(meetsRules(password, rulesForHost("chase.com")!)).toBe(true);
  });

  it("keeps the kinds of characters the generator used, where the site allows them", () => {
    // airfrance.com: 8 to 12, lowercase, uppercase, and a digit required, and -!#$&+/?@_ allowed.
    for (let i = 0; i < 50; i++) {
      const withSymbol = passwordForSite("Abcdefgh1^xy", "www.airfrance.com");
      expect(withSymbol).toMatch(/[-!#$&+/?@_]/);
      expect(meetsRules(withSymbol, rulesForHost("airfrance.com")!)).toBe(true);
    }
    // Letters only (too long for the site) gets the digit the site requires, nothing it doesn't.
    const lettersOnly = passwordForSite("Abcdefghijklmnop", "airfrance.com");
    expect(lettersOnly).toHaveLength(12);
    expect(lettersOnly).toMatch(/[0-9]/);
  });

  it("shortens it to the site's maximum", () => {
    const password = passwordForSite("a".repeat(5) + "B1!" + "c".repeat(40), "163.com");
    expect(password).toHaveLength(16);
  });
});

describe("combineRules", () => {
  it("holds when every one of them does", () => {
    const rules = combineRules(
      // In the rules language, the characters a rule names are all it allows.
      parsePasswordRules("minlength: 8; maxlength: 20; required: digit; allowed: lower, upper;"),
      parsePasswordRules("minlength: 10; maxlength: 16; allowed: lower, digit;"),
    )!;
    expect(rules.minLength).toBe(10);
    expect(rules.maxLength).toBe(16);
    expect(rules.required).toEqual(["0123456789"]);
    expect(sorted(rules.allowed)).toBe(sorted("abcdefghijklmnopqrstuvwxyz0123456789"));
  });

  it("is null with nothing to combine, and passes one set of rules through", () => {
    expect(combineRules(null, undefined)).toBeNull();
    const one = parsePasswordRules("minlength: 8;")!;
    expect(combineRules(one, null)).toEqual(one);
  });
});

describe("rulesForFields", () => {
  it("reads a field's passwordrules, minlength, and maxlength", () => {
    const rules = rulesForFields([
      { passwordRules: "required: upper; required: digit;", minLength: 12, maxLength: 16 },
    ])!;
    expect(rules.minLength).toBe(12);
    expect(rules.maxLength).toBe(16);
    expect(rules.required.map(sorted)).toEqual([sorted(LETTERS.slice(0, 26)), "0123456789"]);
  });

  it("takes the strictest of the new and confirm fields", () => {
    const rules = rulesForFields([{ maxLength: 24 }, { maxLength: 16, minLength: 10 }])!;
    expect(rules.maxLength).toBe(16);
    expect(rules.minLength).toBe(10);
  });

  it("ignores the lengths a browser reports when none is set, and passwordrules it can't read", () => {
    expect(rulesForFields([{ minLength: -1, maxLength: -1, passwordRules: "" }])).toBeNull();
    expect(rulesForFields([{ maxLength: 524288 }])).toBeNull();
    expect(rulesForFields([{ passwordRules: "required: [abc" }])).toBeNull();
    expect(rulesForFields([])).toBeNull();
  });
});

describe("passwordForChange", () => {
  it("keeps the generated password when every rule accepts it", () => {
    expect(
      passwordForChange("Abcdefgh1234!xyz", "example.test", [rulesForFields([{ maxLength: 20 }])]),
    ).toBe("Abcdefgh1234!xyz");
  });

  it("follows the site's published rules and the field's own at once", () => {
    // airfrance.com: 8 to 12; the field adds a minimum of 10 and asks for a digit.
    const field = rulesForFields([
      { minLength: 10, passwordRules: "required: digit; allowed: ascii-printable;" },
    ]);
    const both = combineRules(rulesForHost("airfrance.com"), field)!;
    for (let i = 0; i < 50; i++) {
      const password = passwordForChange("Abcdefghijklmnopqrst!", "www.airfrance.com", [field])!;
      expect(password.length).toBeGreaterThanOrEqual(10);
      expect(password.length).toBeLessThanOrEqual(12);
      expect(meetsRules(password, both)).toBe(true);
    }
  });

  it("follows a field's maxlength and passwordrules on a site without published rules", () => {
    const field = rulesForFields([
      {
        maxLength: 16,
        minLength: 12,
        passwordRules: "required: lower; required: digit; allowed: [-_];",
      },
    ]);
    for (let i = 0; i < 50; i++) {
      const password = passwordForChange("Abcdefghijklmnopqrst!1", "accounts.example.test", [
        field,
      ])!;
      expect(password).toMatch(/^[a-z0-9_-]{12,16}$/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  it("is null when nothing can meet every rule", () => {
    const tooShort = rulesForFields([{ maxLength: 6 }]);
    const tooLong = rulesForFields([{ minLength: 10 }]);
    expect(passwordForChange("Abcdefgh1!", "example.test", [tooShort, tooLong])).toBeNull();
    const nothingAllowed = combineRules(
      parsePasswordRules("allowed: digit;"),
      parsePasswordRules("allowed: lower;"),
    );
    expect(passwordForChange("Abcdefgh1!", "example.test", [nothingAllowed])).toBeNull();
  });
});

describe("secureRandomInt", () => {
  it("stays in range", () => {
    for (let i = 0; i < 1000; i++) {
      const n = secureRandomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });
});
