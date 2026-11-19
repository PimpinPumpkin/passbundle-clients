import {
  countryCode,
  countryOption,
  countryText,
  normalizeName,
  stateOption,
  subdivision,
} from "./address-names";

// Options as upstream collects them: [words, lowercase without spaces or punctuation; value].
const words = (text: string) =>
  text.toLowerCase().replace(/[\s~`!@$%^&#*()\-_+=:;'"[\]|\\,<.>?]/gm, "");
const list = (...options: [string, string][]) =>
  options.map(([text, value]) => [words(text), value]);

describe("names as lists and identities are compared", () => {
  it("ignores case, accents, spaces, and punctuation", () => {
    expect(normalizeName("Baden-Württemberg")).toBe("badenwurttemberg");
    expect(normalizeName("Straße")).toBe("strasse");
    expect(normalizeName("U.S.A.")).toBe("usa");
    expect(normalizeName("東京都")).toBe("東京都");
    expect(normalizeName(null)).toBe("");
  });
});

describe("countries", () => {
  it("knows every ISO 3166-1 code", () => {
    // 249 codes, from AD to ZW.
    const codes = [
      "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ",
      "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ",
      "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ",
      "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR",
      "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU",
      "ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ",
      "LA LB LC LI LK LR LS LT LU LV LY",
      "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ",
      "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA",
      "RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ",
      "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ",
      "VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW",
    ]
      .join(" ")
      .split(" ");
    expect(codes).toHaveLength(249);
    for (const code of codes) {
      expect(countryCode(code)).toBe(code);
      expect(countryCode(code.toLowerCase())).toBe(code);
    }
  });

  it("finds a country by its English name, another common name, or its own name", () => {
    expect(countryCode("Germany")).toBe("DE");
    expect(countryCode("Deutschland")).toBe("DE");
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("UK")).toBe("GB");
    expect(countryCode("England")).toBe("GB");
    expect(countryCode("Österreich")).toBe("AT");
    expect(countryCode("osterreich")).toBe("AT");
    expect(countryCode("USA")).toBe("US");
    expect(countryCode("United States of America")).toBe("US");
    expect(countryCode("Côte d'Ivoire")).toBe("CI");
    expect(countryCode("Narnia")).toBeNull();
    expect(countryCode("")).toBeNull();
  });

  it("chooses a list's option by its value or its words, from a code or a name", () => {
    const names = list(
      ["Choose a country", ""],
      ["Germany", "Germany"],
      ["United Kingdom", "United Kingdom"],
      ["United States", "United States"],
    );
    expect(countryOption(names, "GB")).toBe("United Kingdom");
    expect(countryOption(names, "UK")).toBe("United Kingdom");
    expect(countryOption(names, "Great Britain")).toBe("United Kingdom");
    expect(countryOption(names, "DE")).toBe("Germany");
    expect(countryOption(names, "Deutschland")).toBe("Germany");

    const codes = list(["Deutschland", "DE"], ["Österreich", "AT"], ["Schweiz", "CH"]);
    expect(countryOption(codes, "Austria")).toBe("AT");
    expect(countryOption(codes, "Switzerland")).toBe("CH");
    expect(countryOption(codes, "CH")).toBe("CH");

    // Numbered options, by their words.
    const numbered = list(["Deutschland", "276"], ["Österreich", "40"]);
    expect(countryOption(numbered, "AT")).toBe("40");

    // German names as values.
    const german = list(["Deutschland", "Deutschland"], ["Österreich", "Österreich"]);
    expect(countryOption(german, "DE")).toBe("Deutschland");
    expect(countryOption(german, "Austria")).toBe("Österreich");

    expect(countryOption(names, "France")).toBeNull();
    expect(countryOption(names, "Narnia")).toBeNull();
  });

  it("gives a country field that isn't a list the code we know, or the country as it is", () => {
    expect(countryText("Deutschland")).toBe("DE");
    expect(countryText("Narnia")).toBe("Narnia");
  });
});

describe("states, provinces, and prefectures", () => {
  it("finds one by its code or a name, in the identity's country first", () => {
    expect(subdivision("Bayern")).toEqual({
      country: "DE",
      codes: ["BY"],
      names: ["Bayern", "Bavaria"],
    });
    expect(subdivision("BY", "DE")?.names).toContain("Bayern");
    expect(subdivision("DE-BY")?.codes).toEqual(["BY"]);
    expect(subdivision("WA")?.country).toBe("US");
    expect(subdivision("WA", "Australia")?.names).toEqual(["Western Australia"]);
    expect(subdivision("NT", "CA")?.names[0]).toBe("Northwest Territories");
    expect(subdivision("Tokyo")?.codes).toEqual(["13"]);
    expect(subdivision("東京都", "JP")?.codes).toEqual(["13"]);
    expect(subdivision("Québec")?.codes).toEqual(["QC"]);
    expect(subdivision("Quebec")?.codes).toEqual(["QC"]);
    // A code ISO replaced, with the current one first.
    expect(subdivision("CT", "India")?.codes).toEqual(["CG", "CT"]);
    // Not in that country, or a country we have no table for.
    expect(subdivision("Bayern", "US")).toBeNull();
    expect(subdivision("Kent", "GB")).toBeNull();
    expect(subdivision("")).toBeNull();
  });

  it("chooses a state list's option from a code, for a list of full names", () => {
    const names = list(["State", ""], ["Arizona", "Arizona"], ["California", "California"]);
    expect(stateOption(names, "CA")).toBe("California");
    expect(stateOption(names, "ca", "US")).toBe("California");
    expect(stateOption(names, "California")).toBe("California");
  });

  it("chooses a state list's option from a name, for a list of codes or ISO codes", () => {
    expect(stateOption(list(["Arizona", "AZ"], ["California", "CA"]), "California")).toBe("CA");
    expect(stateOption(list(["Arizona", "US-AZ"], ["California", "US-CA"]), "CA")).toBe("US-CA");
    expect(stateOption(list(["New South Wales", "NSW"], ["Victoria", "VIC"]), "Victoria")).toBe(
      "VIC",
    );
  });

  it("chooses a German state from its code or its English name", () => {
    const german = list(["Bitte wählen", ""], ["Bayern", "Bayern"], ["Berlin", "Berlin"]);
    expect(stateOption(german, "BY", "DE")).toBe("Bayern");
    expect(stateOption(german, "Bavaria", "Germany")).toBe("Bayern");
    expect(stateOption(german, "BY")).toBe("Bayern");
    expect(stateOption(list(["Bayern", "BY"], ["Berlin", "BE"]), "Bayern")).toBe("BY");
  });

  it("chooses a prefecture by its number, name, or Japanese name", () => {
    expect(stateOption(list(["東京都", "13"], ["大阪府", "27"]), "Tokyo", "JP")).toBe("13");
    expect(stateOption(list(["Tokyo", "Tokyo"], ["Osaka", "Osaka"]), "東京都")).toBe("Tokyo");
  });

  it("chooses a state elsewhere as the identity has it", () => {
    const counties = list(["Essex", "Essex"], ["Kent", "Kent"]);
    expect(stateOption(counties, "Kent", "GB")).toBe("Kent");
    expect(stateOption(counties, "kent")).toBe("Kent");
  });

  it("leaves a list alone when none of its options is the state", () => {
    const names = list(["Arizona", "Arizona"], ["California", "California"]);
    expect(stateOption(names, "TX")).toBeNull();
    expect(stateOption(names, "Bayern")).toBeNull();
    // The same code in another country: WA is Western Australia there.
    expect(stateOption(list(["Washington", "Washington"]), "WA", "AU")).toBeNull();
  });
});
