// Keykeeper: countries, states, and provinces by their codes and names
// (DESIGN.md, "Addresses and cards", "States, provinces, and countries", in
// the meta repo). Upstream's identity fill knows only US states and Canadian
// provinces written as English names, and countries written as English names,
// and fills their codes. A state elsewhere written as a name ("Bayern") filled
// nothing, and a list whose options' values are names (value="California",
// value="United Kingdom") was left alone. Called from upstream's
// makeIdentityStateFillScript and makeIdentityCountryFillScript in
// `// Keykeeper:` blocks.
//
// Our own table, written from ISO 3166-1 (country codes) and ISO 3166-2
// (subdivision codes), with the names people write: the English name, other
// common English names, and the country's own name where it differs.
// Subdivisions for the countries whose checkouts most often ask for a state,
// province, or prefecture: the United States (with the US Postal Service's
// armed forces codes), Canada, Mexico, Brazil, Australia, India, Japan, and
// Germany. Elsewhere a state fills as the identity has it.

/** ISO 3166-1 alpha-2 codes, each with the names it goes by, "|" between them. */
const COUNTRIES: Record<string, string> = {
  AD: "Andorra",
  AE: "United Arab Emirates|UAE",
  AF: "Afghanistan",
  AG: "Antigua and Barbuda",
  AI: "Anguilla",
  AL: "Albania",
  AM: "Armenia",
  AO: "Angola",
  AQ: "Antarctica",
  AR: "Argentina",
  AS: "American Samoa",
  AT: "Austria|Österreich",
  AU: "Australia",
  AW: "Aruba",
  AX: "Åland Islands",
  AZ: "Azerbaijan",
  BA: "Bosnia and Herzegovina",
  BB: "Barbados",
  BD: "Bangladesh",
  BE: "Belgium|België|Belgique|Belgien",
  BF: "Burkina Faso",
  BG: "Bulgaria",
  BH: "Bahrain",
  BI: "Burundi",
  BJ: "Benin",
  BL: "Saint Barthélemy",
  BM: "Bermuda",
  BN: "Brunei|Brunei Darussalam",
  BO: "Bolivia",
  BQ: "Caribbean Netherlands|Bonaire, Sint Eustatius and Saba",
  BR: "Brazil|Brasil",
  BS: "Bahamas|The Bahamas",
  BT: "Bhutan",
  BV: "Bouvet Island",
  BW: "Botswana",
  BY: "Belarus",
  BZ: "Belize",
  CA: "Canada",
  CC: "Cocos (Keeling) Islands|Cocos Islands",
  CD: "Democratic Republic of the Congo|Congo (Democratic Republic)|DR Congo",
  CF: "Central African Republic",
  CG: "Congo|Republic of the Congo",
  CH: "Switzerland|Schweiz|Suisse|Svizzera",
  CI: "Côte d'Ivoire|Ivory Coast",
  CK: "Cook Islands",
  CL: "Chile",
  CM: "Cameroon",
  CN: "China",
  CO: "Colombia",
  CR: "Costa Rica",
  CU: "Cuba",
  CV: "Cabo Verde|Cape Verde",
  CW: "Curaçao",
  CX: "Christmas Island",
  CY: "Cyprus",
  CZ: "Czechia|Czech Republic|Česko",
  DE: "Germany|Deutschland",
  DJ: "Djibouti",
  DK: "Denmark|Danmark",
  DM: "Dominica",
  DO: "Dominican Republic",
  DZ: "Algeria",
  EC: "Ecuador",
  EE: "Estonia",
  EG: "Egypt",
  EH: "Western Sahara",
  ER: "Eritrea",
  ES: "Spain|España",
  ET: "Ethiopia",
  FI: "Finland|Suomi",
  FJ: "Fiji",
  FK: "Falkland Islands",
  FM: "Micronesia|Federated States of Micronesia",
  FO: "Faroe Islands",
  FR: "France",
  GA: "Gabon",
  GB: "United Kingdom|UK|Great Britain|Britain|England|Scotland|Wales|Northern Ireland",
  GD: "Grenada",
  GE: "Georgia",
  GF: "French Guiana",
  GG: "Guernsey",
  GH: "Ghana",
  GI: "Gibraltar",
  GL: "Greenland",
  GM: "Gambia|The Gambia",
  GN: "Guinea",
  GP: "Guadeloupe",
  GQ: "Equatorial Guinea",
  GR: "Greece",
  GS: "South Georgia and the South Sandwich Islands",
  GT: "Guatemala",
  GU: "Guam",
  GW: "Guinea-Bissau",
  GY: "Guyana",
  HK: "Hong Kong",
  HM: "Heard Island and McDonald Islands",
  HN: "Honduras",
  HR: "Croatia|Hrvatska",
  HT: "Haiti",
  HU: "Hungary|Magyarország",
  ID: "Indonesia",
  IE: "Ireland|Éire",
  IL: "Israel",
  IM: "Isle of Man",
  IN: "India",
  IO: "British Indian Ocean Territory",
  IQ: "Iraq",
  IR: "Iran",
  IS: "Iceland",
  IT: "Italy|Italia",
  JE: "Jersey",
  JM: "Jamaica",
  JO: "Jordan",
  JP: "Japan|日本",
  KE: "Kenya",
  KG: "Kyrgyzstan",
  KH: "Cambodia",
  KI: "Kiribati",
  KM: "Comoros",
  KN: "Saint Kitts and Nevis",
  KP: "North Korea",
  KR: "South Korea|Republic of Korea",
  KW: "Kuwait",
  KY: "Cayman Islands",
  KZ: "Kazakhstan",
  LA: "Laos",
  LB: "Lebanon",
  LC: "Saint Lucia",
  LI: "Liechtenstein",
  LK: "Sri Lanka",
  LR: "Liberia",
  LS: "Lesotho",
  LT: "Lithuania",
  LU: "Luxembourg",
  LV: "Latvia",
  LY: "Libya",
  MA: "Morocco",
  MC: "Monaco",
  MD: "Moldova",
  ME: "Montenegro",
  MF: "Saint Martin",
  MG: "Madagascar",
  MH: "Marshall Islands",
  MK: "North Macedonia",
  ML: "Mali",
  MM: "Myanmar",
  MN: "Mongolia",
  MO: "Macao|Macau",
  MP: "Northern Mariana Islands",
  MQ: "Martinique",
  MR: "Mauritania",
  MS: "Montserrat",
  MT: "Malta",
  MU: "Mauritius",
  MV: "Maldives",
  MW: "Malawi",
  MX: "Mexico|México",
  MY: "Malaysia",
  MZ: "Mozambique",
  NA: "Namibia",
  NC: "New Caledonia",
  NE: "Niger",
  NF: "Norfolk Island",
  NG: "Nigeria",
  NI: "Nicaragua",
  NL: "Netherlands|The Netherlands|Nederland|Holland",
  NO: "Norway|Norge",
  NP: "Nepal",
  NR: "Nauru",
  NU: "Niue",
  NZ: "New Zealand|Aotearoa",
  OM: "Oman",
  PA: "Panama",
  PE: "Peru",
  PF: "French Polynesia",
  PG: "Papua New Guinea",
  PH: "Philippines",
  PK: "Pakistan",
  PL: "Poland|Polska",
  PM: "Saint Pierre and Miquelon",
  PN: "Pitcairn Islands|Pitcairn",
  PR: "Puerto Rico",
  PS: "Palestine",
  PT: "Portugal",
  PW: "Palau",
  PY: "Paraguay",
  QA: "Qatar",
  RE: "Réunion",
  RO: "Romania",
  RS: "Serbia",
  RU: "Russia|Russian Federation",
  RW: "Rwanda",
  SA: "Saudi Arabia",
  SB: "Solomon Islands",
  SC: "Seychelles",
  SD: "Sudan",
  SE: "Sweden|Sverige",
  SG: "Singapore",
  SH: "Saint Helena, Ascension and Tristan da Cunha|Saint Helena",
  SI: "Slovenia",
  SJ: "Svalbard and Jan Mayen",
  SK: "Slovakia",
  SL: "Sierra Leone",
  SM: "San Marino",
  SN: "Senegal",
  SO: "Somalia",
  SR: "Suriname",
  SS: "South Sudan",
  ST: "São Tomé and Príncipe",
  SV: "El Salvador",
  SX: "Sint Maarten",
  SY: "Syria",
  SZ: "Eswatini|Swaziland",
  TC: "Turks and Caicos Islands",
  TD: "Chad",
  TF: "French Southern Territories",
  TG: "Togo",
  TH: "Thailand",
  TJ: "Tajikistan",
  TK: "Tokelau",
  TL: "Timor-Leste|East Timor",
  TM: "Turkmenistan",
  TN: "Tunisia",
  TO: "Tonga",
  TR: "Türkiye|Turkey",
  TT: "Trinidad and Tobago",
  TV: "Tuvalu",
  TW: "Taiwan",
  TZ: "Tanzania",
  UA: "Ukraine",
  UG: "Uganda",
  UM: "United States Minor Outlying Islands",
  US: "United States|United States of America|USA|U.S.A.|U.S.",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VA: "Vatican City|Holy See",
  VC: "Saint Vincent and the Grenadines",
  VE: "Venezuela",
  VG: "British Virgin Islands|Virgin Islands (British)",
  VI: "U.S. Virgin Islands|Virgin Islands (U.S.)",
  VN: "Vietnam|Viet Nam",
  VU: "Vanuatu",
  WF: "Wallis and Futuna",
  WS: "Samoa",
  YE: "Yemen",
  YT: "Mayotte",
  ZA: "South Africa",
  ZM: "Zambia",
  ZW: "Zimbabwe",
};

/**
 * States, provinces, and prefectures by their ISO 3166-2 codes without the
 * country's part ("CA" for US-CA, "13" for JP-13), each with its names, "|"
 * between them. Where ISO changed a code, the old one is listed too.
 */
const SUBDIVISIONS: Record<string, Record<string, string>> = {
  US: {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    DC: "District of Columbia|Washington, D.C.|Washington DC",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    AS: "American Samoa",
    GU: "Guam",
    MP: "Northern Mariana Islands",
    PR: "Puerto Rico",
    UM: "United States Minor Outlying Islands",
    VI: "U.S. Virgin Islands|Virgin Islands",
    // The US Postal Service's, for military mail; not ISO's.
    AA: "Armed Forces Americas",
    AE: "Armed Forces Europe",
    AP: "Armed Forces Pacific",
  },
  CA: {
    AB: "Alberta",
    BC: "British Columbia|Colombie-Britannique",
    MB: "Manitoba",
    NB: "New Brunswick|Nouveau-Brunswick",
    NL: "Newfoundland and Labrador|Terre-Neuve-et-Labrador|Newfoundland",
    NS: "Nova Scotia|Nouvelle-Écosse",
    NT: "Northwest Territories|Territoires du Nord-Ouest",
    NU: "Nunavut",
    ON: "Ontario",
    PE: "Prince Edward Island|Île-du-Prince-Édouard",
    QC: "Quebec|Québec",
    SK: "Saskatchewan",
    YT: "Yukon",
  },
  MX: {
    AGU: "Aguascalientes",
    BCN: "Baja California",
    BCS: "Baja California Sur",
    CAM: "Campeche",
    CHP: "Chiapas",
    CHH: "Chihuahua",
    CMX: "Ciudad de México|Mexico City|CDMX|Distrito Federal",
    COA: "Coahuila|Coahuila de Zaragoza",
    COL: "Colima",
    DUR: "Durango",
    GUA: "Guanajuato",
    GRO: "Guerrero",
    HID: "Hidalgo",
    JAL: "Jalisco",
    MEX: "Estado de México|México|State of Mexico",
    MIC: "Michoacán|Michoacán de Ocampo",
    MOR: "Morelos",
    NAY: "Nayarit",
    NLE: "Nuevo León",
    OAX: "Oaxaca",
    PUE: "Puebla",
    QUE: "Querétaro",
    ROO: "Quintana Roo",
    SLP: "San Luis Potosí",
    SIN: "Sinaloa",
    SON: "Sonora",
    TAB: "Tabasco",
    TAM: "Tamaulipas",
    TLA: "Tlaxcala",
    VER: "Veracruz|Veracruz de Ignacio de la Llave",
    YUC: "Yucatán",
    ZAC: "Zacatecas",
  },
  BR: {
    AC: "Acre",
    AL: "Alagoas",
    AP: "Amapá",
    AM: "Amazonas",
    BA: "Bahia",
    CE: "Ceará",
    DF: "Distrito Federal",
    ES: "Espírito Santo",
    GO: "Goiás",
    MA: "Maranhão",
    MT: "Mato Grosso",
    MS: "Mato Grosso do Sul",
    MG: "Minas Gerais",
    PA: "Pará",
    PB: "Paraíba",
    PR: "Paraná",
    PE: "Pernambuco",
    PI: "Piauí",
    RJ: "Rio de Janeiro",
    RN: "Rio Grande do Norte",
    RS: "Rio Grande do Sul",
    RO: "Rondônia",
    RR: "Roraima",
    SC: "Santa Catarina",
    SP: "São Paulo",
    SE: "Sergipe",
    TO: "Tocantins",
  },
  AU: {
    ACT: "Australian Capital Territory",
    NSW: "New South Wales",
    NT: "Northern Territory",
    QLD: "Queensland",
    SA: "South Australia",
    TAS: "Tasmania",
    VIC: "Victoria",
    WA: "Western Australia",
  },
  IN: {
    AN: "Andaman and Nicobar Islands",
    AP: "Andhra Pradesh",
    AR: "Arunachal Pradesh",
    AS: "Assam",
    BR: "Bihar",
    CH: "Chandigarh",
    CG: "Chhattisgarh",
    CT: "Chhattisgarh",
    DH: "Dadra and Nagar Haveli and Daman and Diu",
    DL: "Delhi|New Delhi",
    GA: "Goa",
    GJ: "Gujarat",
    HR: "Haryana",
    HP: "Himachal Pradesh",
    JK: "Jammu and Kashmir",
    JH: "Jharkhand",
    KA: "Karnataka",
    KL: "Kerala",
    LA: "Ladakh",
    LD: "Lakshadweep",
    MP: "Madhya Pradesh",
    MH: "Maharashtra",
    MN: "Manipur",
    ML: "Meghalaya",
    MZ: "Mizoram",
    NL: "Nagaland",
    OD: "Odisha|Orissa",
    OR: "Odisha|Orissa",
    PY: "Puducherry|Pondicherry",
    PB: "Punjab",
    RJ: "Rajasthan",
    SK: "Sikkim",
    TN: "Tamil Nadu",
    TS: "Telangana",
    TG: "Telangana",
    TR: "Tripura",
    UP: "Uttar Pradesh",
    UK: "Uttarakhand|Uttaranchal",
    UT: "Uttarakhand|Uttaranchal",
    WB: "West Bengal",
  },
  JP: {
    "01": "Hokkaido|北海道",
    "02": "Aomori|青森県",
    "03": "Iwate|岩手県",
    "04": "Miyagi|宮城県",
    "05": "Akita|秋田県",
    "06": "Yamagata|山形県",
    "07": "Fukushima|福島県",
    "08": "Ibaraki|茨城県",
    "09": "Tochigi|栃木県",
    "10": "Gunma|群馬県",
    "11": "Saitama|埼玉県",
    "12": "Chiba|千葉県",
    "13": "Tokyo|東京都",
    "14": "Kanagawa|神奈川県",
    "15": "Niigata|新潟県",
    "16": "Toyama|富山県",
    "17": "Ishikawa|石川県",
    "18": "Fukui|福井県",
    "19": "Yamanashi|山梨県",
    "20": "Nagano|長野県",
    "21": "Gifu|岐阜県",
    "22": "Shizuoka|静岡県",
    "23": "Aichi|愛知県",
    "24": "Mie|三重県",
    "25": "Shiga|滋賀県",
    "26": "Kyoto|京都府",
    "27": "Osaka|大阪府",
    "28": "Hyogo|兵庫県",
    "29": "Nara|奈良県",
    "30": "Wakayama|和歌山県",
    "31": "Tottori|鳥取県",
    "32": "Shimane|島根県",
    "33": "Okayama|岡山県",
    "34": "Hiroshima|広島県",
    "35": "Yamaguchi|山口県",
    "36": "Tokushima|徳島県",
    "37": "Kagawa|香川県",
    "38": "Ehime|愛媛県",
    "39": "Kochi|高知県",
    "40": "Fukuoka|福岡県",
    "41": "Saga|佐賀県",
    "42": "Nagasaki|長崎県",
    "43": "Kumamoto|熊本県",
    "44": "Oita|大分県",
    "45": "Miyazaki|宮崎県",
    "46": "Kagoshima|鹿児島県",
    "47": "Okinawa|沖縄県",
  },
  DE: {
    BW: "Baden-Württemberg",
    BY: "Bayern|Bavaria",
    BE: "Berlin",
    BB: "Brandenburg",
    HB: "Bremen",
    HH: "Hamburg",
    HE: "Hessen|Hesse",
    MV: "Mecklenburg-Vorpommern|Mecklenburg-Western Pomerania",
    NI: "Niedersachsen|Lower Saxony",
    NW: "Nordrhein-Westfalen|North Rhine-Westphalia",
    RP: "Rheinland-Pfalz|Rhineland-Palatinate",
    SL: "Saarland",
    SN: "Sachsen|Saxony",
    ST: "Sachsen-Anhalt|Saxony-Anhalt",
    SH: "Schleswig-Holstein",
    TH: "Thüringen|Thuringia",
  },
};

/** Where to look for a state when the identity has no country we know. */
const SUBDIVISION_ORDER = ["US", "CA", "MX", "BR", "AU", "IN", "JP", "DE"];

/**
 * Text as a list's options and an identity's values are compared: lowercase,
 * without accents, spaces, or punctuation ("Baden-Württemberg" is
 * "badenwurttemberg", "Straße" is "strasse").
 */
export function normalizeName(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const names = (list: string) => list.split("|");

/** A country's ISO 3166-1 code, from its code or one of its names; null when we don't know it. */
export function countryCode(value: string | null | undefined): string | null {
  const wanted = normalizeName(value);
  if (wanted === "") {
    return null;
  }
  const upper = wanted.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(COUNTRIES, upper)) {
    return upper;
  }
  for (const [code, list] of Object.entries(COUNTRIES)) {
    if (names(list).some((n) => normalizeName(n) === wanted)) {
      return code;
    }
  }
  return null;
}

/**
 * A state, province, or prefecture we know: its country, its codes there (the
 * current one first, then one ISO replaced), and its names.
 */
export type Subdivision = { country: string; codes: string[]; names: string[] };

/**
 * The state, province, or prefecture an identity means, from its code ("BY",
 * "DE-BY") or one of its names ("Bayern", "Bavaria"). In the identity's
 * country when we know it, and otherwise the first country that has it:
 * the United States, then Canada, as upstream looks, then the rest. Null
 * when we don't know it.
 */
export function subdivision(
  state: string | null | undefined,
  country?: string | null,
): Subdivision | null {
  const wanted = normalizeName(state);
  if (wanted === "") {
    return null;
  }
  const known = countryCode(country);
  const countries = known != null ? [known] : SUBDIVISION_ORDER;
  for (const c of countries) {
    const table = SUBDIVISIONS[c];
    if (table == null) {
      continue;
    }
    for (const [code, list] of Object.entries(table)) {
      const matches =
        wanted === normalizeName(code) ||
        wanted === normalizeName(`${c}-${code}`) ||
        names(list).some((n) => normalizeName(n) === wanted);
      if (matches) {
        const codes = Object.keys(table).filter((k) => table[k] === list);
        return { country: c, codes, names: names(list) };
      }
    }
  }
  return null;
}

/** A list's options, as upstream collects them: [its words, lowercase without spaces or punctuation; its value]. */
export type SelectOptions = (string | null)[][];

/**
 * The value of the first option whose value or words are one of these, compared
 * as normalizeName does; null when none is.
 */
export function optionFor(options: SelectOptions, candidates: string[]): string | null {
  const wanted = new Set(candidates.map(normalizeName).filter((c) => c !== ""));
  const found = options.find((o) => {
    const value = normalizeName(o[1]);
    const words = normalizeName(o[0]);
    return (value !== "" && wanted.has(value)) || (words !== "" && wanted.has(words));
  });
  return found != null ? (found[1] ?? null) : null;
}

/**
 * The option in a country list for an identity's country, written as a code
 * or a name, by the options' values ("GB", "United Kingdom") and words; null
 * when the list has none, so it's left as it is.
 */
export function countryOption(
  options: SelectOptions,
  country: string | null | undefined,
): string | null {
  const code = countryCode(country);
  const candidates = [country ?? ""];
  if (code != null) {
    candidates.push(code, ...names(COUNTRIES[code]));
  }
  return optionFor(options, candidates);
}

/**
 * The option in a state or province list for an identity's state, written as
 * a code or a name, by the options' values ("CA", "US-CA", "California") and
 * words; null when the list has none, so it's left as it is.
 */
export function stateOption(
  options: SelectOptions,
  state: string | null | undefined,
  country?: string | null,
): string | null {
  const found = subdivision(state, country);
  const candidates = [state ?? ""];
  if (found != null) {
    for (const code of found.codes) {
      candidates.push(code, `${found.country}-${code}`);
    }
    candidates.push(...found.names);
  }
  return optionFor(options, candidates);
}

/**
 * What a country field that isn't a list gets when upstream's table doesn't
 * know the identity's country: its code where ours does, as upstream fills a
 * code for the names it knows, and otherwise the country as the identity has
 * it.
 */
export function countryText(country: string): string {
  return countryCode(country) ?? country;
}
