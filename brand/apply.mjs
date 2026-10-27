#!/usr/bin/env node
// Applies the brand in brand/brand.json to this working tree before a build,
// and reverts it afterwards. Upstream files stay untouched in git, so merges
// from bitwarden/clients never conflict with branding.
//
//   node brand/apply.mjs            apply
//   node brand/apply.mjs --revert   restore every file apply touched
//
// Apply refuses to run over uncommitted changes in apps/ or libs/, because
// revert restores files from git. It fails loudly when an upstream file no
// longer looks the way this script expects.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, "brand/brand.json"), "utf8"));
const GEN = path.join(ROOT, "brand/assets/generated");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
// Kept inside .git so it never shows up as a change and needs no .gitignore entry.
const STATE = path.resolve(
  ROOT,
  git("rev-parse", "--git-dir").trim(),
  "keykeeper-brand-applied.json",
);
const abs = (rel) => path.join(ROOT, rel);
const read = (rel) => fs.readFileSync(abs(rel), "utf8");

function fail(message) {
  console.error(`brand: ${message}`);
  process.exit(1);
}

const touched = new Set();
function write(rel, content) {
  fs.writeFileSync(abs(rel), content);
  touched.add(rel);
}
function copyInto(fromAbs, rel) {
  if (!fs.existsSync(abs(rel))) {
    fail(`${rel} does not exist upstream anymore. Update brand/apply.mjs.`);
  }
  fs.copyFileSync(fromAbs, abs(rel));
  touched.add(rel);
}
// A file of ours where upstream has none; revert deletes it again.
function addFile(fromAbs, rel) {
  if (fs.existsSync(abs(rel))) {
    fail(`${rel} exists upstream now. Update brand/apply.mjs.`);
  }
  fs.copyFileSync(fromAbs, abs(rel));
  touched.add(rel);
}
function replaceAnchored(rel, pattern, replacement) {
  const source = read(rel);
  if (!pattern.test(source)) {
    fail(
      `expected pattern not found in ${rel}: ${pattern}. Upstream changed. Update brand/apply.mjs.`,
    );
  }
  write(rel, source.replace(pattern, replacement));
}

// A brand scale like upstream's (050 lightest to 950 darkest, 700 is the base
// color), mixed toward white and black in sRGB.
function brandPalette(baseHex) {
  const n = parseInt(baseHex.slice(1), 16);
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (to, t) => base.map((v, i) => Math.round(v + (to[i] - v) * t));
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  return {
    "050": mix(white, 0.94),
    100: mix(white, 0.87),
    200: mix(white, 0.74),
    300: mix(white, 0.56),
    400: mix(white, 0.4),
    500: mix(white, 0.24),
    600: mix(white, 0.12),
    700: base,
    800: mix(black, 0.22),
    900: mix(black, 0.42),
    950: mix(black, 0.58),
  };
}

// GPLv3 section 5(d) requires keeping the original copyright notice in the UI.
const COPYRIGHT_TOKEN = "\u0000COPYRIGHT\u0000";
function brandText(text) {
  return text
    .replaceAll("Bitwarden Inc.", COPYRIGHT_TOKEN)
    .replace(/(https?:\/\/)?(www\.)?bitwarden\.(com|eu)/g, BRAND.urls.website)
    .replace(/\bBitwarden\b/g, BRAND.name)
    .replaceAll(COPYRIGHT_TOKEN, `Bitwarden Inc. and ${BRAND.name} contributors`);
}

function trackedFiles(...pathspecs) {
  return git("ls-files", "--", ...pathspecs, ":!:bitwarden_license/**")
    .split("\n")
    .filter(Boolean);
}

function revert() {
  if (!fs.existsSync(STATE)) {
    console.log("brand: nothing to revert");
    return;
  }
  const files = JSON.parse(fs.readFileSync(STATE, "utf8"));
  // Files we added aren't in git: delete those, restore the rest.
  const tracked = new Set();
  for (let i = 0; i < files.length; i += 200) {
    for (const f of git("ls-files", "--", ...files.slice(i, i + 200)).split("\n")) {
      if (f) tracked.add(f);
    }
  }
  const restore = files.filter((f) => tracked.has(f));
  for (const f of files.filter((f) => !tracked.has(f))) fs.rmSync(abs(f), { force: true });
  for (let i = 0; i < restore.length; i += 200) {
    git("checkout", "--", ...restore.slice(i, i + 200));
  }
  fs.rmSync(STATE);
  console.log(`brand: reverted ${files.length} files`);
}

function apply() {
  if (fs.existsSync(STATE)) {
    fail("branding is already applied. Run with --revert first.");
  }
  const dirty = git("status", "--porcelain", "--untracked-files=no", "--", "apps", "libs").trim();
  if (dirty) {
    fail("apps/ or libs/ has uncommitted changes. Commit or stash them first.");
  }
  // Record progress as we go, so a failure halfway can still be reverted.
  process.on("exit", () => {
    if (touched.size) fs.writeFileSync(STATE, JSON.stringify([...touched].sort(), null, 2));
  });

  // 1. Translations, in every language.
  const locales = trackedFiles(
    "apps/browser/src/_locales/*/messages.json",
    "apps/web/src/locales/*/messages.json",
    "apps/desktop/src/locales/*/messages.json",
    "apps/cli/src/locales/*/messages.json",
  );
  if (locales.length < 150) fail(`found only ${locales.length} locale files. Upstream moved them?`);
  for (const rel of locales) {
    const data = JSON.parse(read(rel).replace(/^﻿/, ""));
    for (const entry of Object.values(data)) {
      if (typeof entry?.message === "string") entry.message = brandText(entry.message);
    }
    write(rel, JSON.stringify(data, null, 2) + "\n");
  }

  // 1b. Keykeeper's own strings, added to every app's English translations.
  //     Other languages fall back to English until they are translated.
  const ownMessages = JSON.parse(
    fs.readFileSync(path.join(ROOT, "brand/messages.en.json"), "utf8"),
  );
  // The Windows install script's file name, for the MSP console's install
  // command. It carries the product name, so it comes from brand.json.
  if (typeof BRAND.installScript !== "string" || !/^[\w-]+\.ps1$/.test(BRAND.installScript)) {
    fail(
      'brand.json needs "installScript", the install script\'s file name, such as "Install-Example.ps1".',
    );
  }
  ownMessages.keykeeperInstallScript = { message: BRAND.installScript };
  for (const rel of trackedFiles(
    "apps/browser/src/_locales/en/messages.json",
    "apps/web/src/locales/en/messages.json",
    "apps/desktop/src/locales/en/messages.json",
  )) {
    const data = JSON.parse(read(rel).replace(/^\uFEFF/, ""));
    for (const [key, value] of Object.entries(ownMessages)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        fail(`${rel} already has a "${key}" message. Rename ours.`);
      }
      data[key] = value;
    }
    write(rel, JSON.stringify(data, null, 2) + "\n");
  }

  // 1c. Upstream's English strings in our words (brand/wording.en.json): one
  //     word, folder, for every place an item lives, and no "vault" except
  //     where it means the whole encrypted store. Only the message changes;
  //     placeholders stay upstream's. A key no app has fails, so an upstream
  //     rename is noticed. See DESIGN.md, "Folders and permissions".
  const wording = JSON.parse(fs.readFileSync(path.join(ROOT, "brand/wording.en.json"), "utf8"));
  const wordingApps = {
    web: "apps/web/src/locales/en/messages.json",
    browser: "apps/browser/src/_locales/en/messages.json",
  };
  const wordingFiles = Object.fromEntries(
    Object.entries(wordingApps).map(([app, rel]) => [app, JSON.parse(read(rel).replace(/^﻿/, ""))]),
  );
  const reworded = new Set();
  // "{brand}" in a message is the product's name from brand.json.
  const reword = (app, key, value) => {
    if (typeof value?.message !== "string" || /Bitwarden/.test(value.message)) {
      fail(`brand/wording.en.json: "${key}" needs a message, without upstream's name.`);
    }
    const entry = wordingFiles[app][key];
    if (entry) {
      entry.message = value.message.replaceAll("{brand}", BRAND.name);
      reworded.add(key);
    }
  };
  for (const [key, value] of Object.entries(wording.all ?? {})) {
    for (const app of Object.keys(wordingApps)) reword(app, key, value);
  }
  for (const app of Object.keys(wordingApps)) {
    for (const [key, value] of Object.entries(wording[app] ?? {})) reword(app, key, value);
  }
  const unknown = [
    ...Object.keys(wording.all ?? {}),
    ...Object.keys(wordingApps).flatMap((app) => Object.keys(wording[app] ?? {})),
  ].filter((key) => !reworded.has(key));
  if (unknown.length) {
    fail(`brand/wording.en.json: no app has ${unknown.join(", ")}. Upstream renamed them?`);
  }
  for (const [app, rel] of Object.entries(wordingApps)) {
    write(rel, JSON.stringify(wordingFiles[app], null, 2) + "\n");
  }

  // 2. Hard-coded text in HTML templates.
  let templates = 0;
  for (const rel of trackedFiles("apps/**/*.html", "apps/**/*.ejs", "libs/**/*.html")) {
    const source = read(rel);
    const branded = brandText(source);
    if (branded !== source) {
      write(rel, branded);
      templates++;
    }
  }

  // 3. Logos used by the shared component library.
  const themedWordmark = fs.readFileSync(path.join(GEN, "wordmark-themed.svg"), "utf8");
  const themedMark = fs.readFileSync(path.join(GEN, "mark-themed.svg"), "utf8");
  replaceAnchored(
    "libs/assets/src/svg/svgs/bitwarden-logo.icon.ts",
    /export const BitwardenLogo = svg`[\s\S]*?`;/,
    `export const BitwardenLogo = svg\`${themedWordmark}\`;`,
  );
  replaceAnchored(
    "libs/assets/src/svg/svgs/shield.ts",
    /const BitwardenShield = svg`[\s\S]*?`;/,
    `const BitwardenShield = svg\`${themedMark}\`;`,
  );
  // Every product's corner logo is the one-line wordmark: the product's name
  // stays in the logo link's label and the product switcher.
  const svgModules = [
    ["password-manager.ts", "const PasswordManagerLogo", "logo-nav.svg"],
    ["admin-console.ts", "const AdminConsoleLogo", "logo-nav.svg"],
    ["provider-portal.ts", "const ProviderPortalLogo", "logo-nav.svg"],
    ["secrets-manager.ts", "const SecretsManagerLogo", "logo-nav.svg"],
    ["bitwarden-icon.ts", "export const BitwardenIcon", "icon-square.svg"],
  ];
  for (const [file, declaration, asset] of svgModules) {
    const markup = fs.readFileSync(path.join(GEN, asset), "utf8");
    replaceAnchored(
      `libs/assets/src/svg/svgs/${file}`,
      new RegExp(`${declaration} = svg\`[\\s\\S]*?\`;`),
      `${declaration} = svg\`${markup}\`;`,
    );
  }

  // 3b. Illustrations and tab icons: ours, drawn from the logo's shapes
  //     (brand/artwork/draw.mjs), replace each upstream drawing by its name.
  const artDir = path.join(ROOT, "brand/artwork");
  const svgDir = "libs/assets/src/svg/svgs";
  const drawings = new Map(
    fs
      .readdirSync(artDir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => [f.slice(0, -4), fs.readFileSync(path.join(artDir, f), "utf8").trim()]),
  );
  if (drawings.size < 50) fail(`only ${drawings.size} drawings in brand/artwork. Run draw.mjs.`);
  const placed = new Set();
  for (const file of fs.readdirSync(abs(svgDir)).filter((f) => f.endsWith(".ts"))) {
    const rel = `${svgDir}/${file}`;
    let source = read(rel);
    let changed = false;
    source = source.replace(
      /((?:export )?const (\w+) = svg`)[\s\S]*?(`;)/g,
      (all, head, symbol, tail) => {
        const drawing = drawings.get(symbol);
        if (!drawing) return all;
        placed.add(symbol);
        changed = true;
        return `${head}\n${drawing}\n${tail}`;
      },
    );
    if (changed) write(rel, source);
  }
  const missing = [...drawings.keys()].filter((symbol) => !placed.has(symbol));
  if (missing.length) fail(`no upstream drawing named ${missing.join(", ")}. Upstream renamed it?`);

  // 4. Cloud regions: ours replace Bitwarden's US, EU, and Gov clouds.
  const u = BRAND.urls;
  replaceAnchored(
    "libs/common/src/platform/services/default-environment.service.ts",
    /export const PRODUCTION_REGIONS: RegionConfig\[\] = \[[\s\S]*?\n\];/,
    `export const PRODUCTION_REGIONS: RegionConfig[] = [
  {
    key: Region.US,
    domain: ${JSON.stringify(BRAND.domain)},
    urls: {
      base: null,
      api: ${JSON.stringify(u.api)},
      identity: ${JSON.stringify(u.identity)},
      icons: ${JSON.stringify(u.icons)},
      webVault: ${JSON.stringify(u.webVault)},
      notifications: ${JSON.stringify(u.notifications)},
      events: ${JSON.stringify(u.events)},
      scim: ${JSON.stringify(u.scim)},
      send: ${JSON.stringify(u.send)},
    },
  },
];`,
  );

  // 5. Browser extension manifests and icons. Native messaging, which talks
  //    to the desktop agent, is a required permission rather than upstream's
  //    optional one, so biometric unlock needs no extra prompt or reload
  //    (DESIGN.md, "Biometric unlock").
  for (const rel of ["apps/browser/src/manifest.json", "apps/browser/src/manifest.v3.json"]) {
    const manifest = JSON.parse(read(rel));
    if (manifest.author !== "Bitwarden Inc.") fail(`unexpected author in ${rel}`);
    manifest.author = BRAND.company;
    for (const [key, list] of Object.entries(manifest)) {
      if (/^(__\w+__)?optional_permissions$/.test(key) && Array.isArray(list)) {
        manifest[key] = list.filter((p) => p !== "nativeMessaging");
        const required = key.replace("optional_", "");
        // Firefox's own list, where there is one; otherwise the shared list.
        const target = Array.isArray(manifest[required]) ? required : "permissions";
        if (!manifest[target].includes("nativeMessaging")) manifest[target].push("nativeMessaging");
      }
    }
    write(rel, brandText(JSON.stringify(manifest, null, 2)) + "\n");
  }

  // 5b. The desktop agent's native-messaging host. Upstream's name would
  //     reach upstream's desktop app, if one is installed.
  if (
    typeof BRAND.nativeMessagingHost !== "string" ||
    !/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(BRAND.nativeMessagingHost)
  ) {
    fail('brand.json needs "nativeMessagingHost", such as "com.example.agent".');
  }
  for (const rel of [
    "apps/browser/src/background/nativeMessaging.background.ts",
    "apps/browser/src/platform/ipc/transports/desktop-ipc.transport.ts",
  ]) {
    replaceAnchored(
      rel,
      /connectNative\("com\.8bit\.bitwarden"\)/,
      `connectNative(${JSON.stringify(BRAND.nativeMessagingHost)})`,
    );
  }
  for (const file of fs.readdirSync(path.join(GEN, "browser"))) {
    copyInto(path.join(GEN, "browser", file), `apps/browser/src/images/${file}`);
  }

  // 6. Web vault: app manifest, U2F facets, icons, and logos.
  write("apps/web/src/manifest.json", brandText(read("apps/web/src/manifest.json")));
  write(
    "apps/web/src/app-id.json",
    JSON.stringify(
      { trustedFacets: [{ version: { major: 1, minor: 0 }, ids: [BRAND.urls.webVault] }] },
      null,
      2,
    ) + "\n",
  );
  replaceAnchored("apps/web/src/index.html", /color="#175DDC"/, `color="${BRAND.color}"`);
  replaceAnchored(
    "apps/web/src/index.html",
    /<meta name="theme-color" content="#175DDC" \/>/,
    `<meta name="theme-color" content="${BRAND.color}" />`,
  );
  // The loading screen draws upstream's two background drawings inline, before
  // the app (and its drawings) loads: ours instead, by their size.
  for (const [viewBox, symbol] of [
    ["0 0 501 226", "BackgroundLeftIllustration"],
    ["0 0 506 297", "BackgroundRightIllustration"],
  ]) {
    const ours = fs.readFileSync(path.join(ROOT, "brand/artwork", `${symbol}.svg`), "utf8").trim();
    replaceAnchored(
      "apps/web/src/index.html",
      new RegExp(
        `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${viewBox}">[\\s\\S]*?</svg>`,
      ),
      () => ours,
    );
  }
  for (const file of fs.readdirSync(path.join(GEN, "web"))) {
    const from = path.join(GEN, "web", file);
    if (file === "favicon.ico") copyInto(from, "apps/web/src/favicon.ico");
    else if (file.startsWith("logo")) copyInto(from, `apps/web/src/images/${file}`);
    else copyInto(from, `apps/web/src/images/icons/${file}`);
  }

  // 7. Links to Bitwarden's website in code: help, products, downloads, legal,
  //    and the page the extension opens after a user installs it. Subdomains
  //    like vault.bitwarden.com are functional and left alone. Tests keep theirs.
  let codeFiles = 0;
  for (const rel of trackedFiles("apps/**/*.ts", "libs/**/*.ts")) {
    if (/\.spec\.ts$|\.stories\.ts$|\/spec-data\/|\/spec\/|\/test\//.test(rel)) continue;
    const source = read(rel);
    const branded = source.replace(
      /(["'`])https:\/\/(www\.)?bitwarden\.com\//g,
      `$1${BRAND.urls.website}/`,
    );
    if (branded !== source) {
      write(rel, branded);
      codeFiles++;
    }
  }
  if (codeFiles < 10)
    fail(`rewrote website links in only ${codeFiles} code files. Upstream changed?`);

  // 8. Theme colors: a brand scale generated from brand.json's color replaces
  //    upstream's blue, in light and dark themes. Appended, so upstream's
  //    theme file merges cleanly.
  const palette = brandPalette(BRAND.color);
  const rgb = (c) => c.join(" ");
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const scale = Object.entries(palette)
    .map(([step, c]) => `  --color-brand-${step}: ${hex(c)};`)
    .join("\n");
  const themeFile = "libs/components/src/tw-theme.css";
  if (!read(themeFile).includes("--color-brand-700:"))
    fail(`${themeFile} has no brand scale anymore.`);
  write(
    themeFile,
    read(themeFile) +
      `
/* ${BRAND.name} brand palette, generated by brand/apply.mjs from brand.json. */
:root,
.theme_light {
${scale}
  --color-brand-950-rgb: ${palette["950"].join(", ")};
  --color-primary-100: ${rgb(palette["100"])};
  --color-primary-300: ${rgb(palette["400"])};
  --color-primary-600: ${rgb(palette["700"])};
  --color-primary-700: ${rgb(palette["800"])};
  --color-marketing-logo: ${rgb(palette["700"])};
}
.theme_dark {
  --color-primary-100: ${rgb(palette["950"])};
  --color-primary-300: ${rgb(palette["800"])};
  --color-primary-600: ${rgb(palette["400"])};
  --color-primary-700: ${rgb(palette["200"])};
}
`,
  );
  // 8b. The typeface, Google Sans Flex, goes into the shared theme.css, which
  //     tw-theme.css imports and what the extension draws inside websites
  //     imports alone, so every surface has it. Then the look: the design
  //     language for the web vault and the extension's popup, light and dark,
  //     and the brand's illustration colors (DESIGN.md, "The look").
  const fontDir = path.join(ROOT, "brand/assets/fonts");
  for (const font of fs.readdirSync(fontDir).filter((f) => f.endsWith(".woff2"))) {
    addFile(path.join(fontDir, font), `libs/components/src/webfonts/${font}`);
  }
  const sharedThemeFile = "libs/components/src/theme.css";
  if (!/--font-sans:/.test(read(sharedThemeFile)))
    fail(`${sharedThemeFile} doesn't set --font-sans anymore.`);
  write(
    sharedThemeFile,
    read(sharedThemeFile) + "\n" + fs.readFileSync(path.join(ROOT, "brand/fonts.css"), "utf8"),
  );
  write(
    themeFile,
    read(themeFile) + "\n" + fs.readFileSync(path.join(ROOT, "brand/look.css"), "utf8"),
  );

  // Older SCSS and the autofill UI injected into websites hard-code the blue.
  for (const rel of trackedFiles(
    "apps/browser/src/**/*.scss",
    "apps/browser/src/autofill/**/*.ts",
    "libs/assets/src/**/*.ts",
  )) {
    if (/\.spec\.ts$/.test(rel)) continue;
    const source = read(rel);
    const branded = source.replace(/#175ddc/gi, BRAND.color);
    if (branded !== source) write(rel, branded);
  }
  // The save bar's palettes are PassBundle's in the source already
  // (content/components/constants/styles.ts).

  // 9. The icon inside login fields, and the shield on the save-password bar.
  const markPath = /\bd="([^"]+)"/.exec(
    fs.readFileSync(path.join(ROOT, "brand/assets/mark.svg"), "utf8"),
  )[1];
  const inlineIcon = (size, color) =>
    `'<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-3 0 32 32" fill="none" data-brand="${BRAND.name}"><path fill="${color}" fill-rule="evenodd" d="${markPath}"/></svg>'`;
  replaceAnchored(
    "apps/browser/src/autofill/utils/svg-icons.ts",
    /export const logoIcon =\s*'[^']*';/,
    `export const logoIcon =\n  ${inlineIcon(14, BRAND.color)};`,
  );
  replaceAnchored(
    "apps/browser/src/autofill/utils/svg-icons.ts",
    /export const logoLockedIcon =\s*'[^']*';/,
    `export const logoLockedIcon =\n  ${inlineIcon(16, "#8A8A8A")};`,
  );
  // 10. Upstream's icon font has a brand shield glyph (and a plain shield used
  //     as the brand in places). Draw our mark instead, in the text color.
  const iconCss = "libs/angular/src/scss/bwicons/styles/style.css";
  if (!/\.bwi-bitwarden-shield:before/.test(read(iconCss)))
    fail(`${iconCss} has no brand shield glyph anymore.`);
  const maskSvg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 0 32 32"><path fill="black" fill-rule="evenodd" d="${markPath}"/></svg>`,
  );
  write(
    iconCss,
    read(iconCss) +
      `
/* ${BRAND.name}: the brand shield glyphs draw our mark. Added by brand/apply.mjs. */
.bwi-bitwarden-shield:before,
.bwi-shield:before {
  content: "" !important;
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask: url("data:image/svg+xml,${maskSvg}") center / contain no-repeat;
  mask: url("data:image/svg+xml,${maskSvg}") center / contain no-repeat;
}
`,
  );

  replaceAnchored(
    "apps/browser/src/autofill/content/components/icons/shield.ts",
    /viewBox="0 0 14 16"([\s\S]*?)d="[^"]*"/,
    `viewBox="-3 0 32 32" data-brand="${BRAND.name}"$1fill-rule="evenodd"\n        d="${markPath}"`,
  );

  // 11. The command-line tool: its command, its environment variables, its
  //     data folder, its own version, and its help and messages. Upstream's
  //     code reads upstream's variable names; apps/cli/src/keykeeper/env.ts
  //     copies ours to them at startup. See docs/cli.md in the meta repo.
  brandCli();

  console.log(
    `brand: applied "${BRAND.name}" to ${touched.size} files ` +
      `(${locales.length} locale files, ${templates} templates)`,
  );
}

function brandCli() {
  const cli = BRAND.cli;
  if (
    cli == null ||
    !/^[a-z][a-z0-9-]*$/.test(cli.command ?? "") ||
    !/^[A-Z][A-Z0-9]*_$/.test(cli.envPrefix ?? "") ||
    cli.envPrefix === "BW_" ||
    !/^https:\/\//.test(cli.releases ?? "")
  ) {
    fail(
      'brand.json needs "cli": {"command", "envPrefix" (such as "EXAMPLE_"), "releases" (an https address)}.',
    );
  }
  // The tool's own version: the release's, or a development build's.
  const version = process.env.BRAND_CLI_VERSION || "0.0.0-dev";
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
    fail(`BRAND_CLI_VERSION "${version}" isn't a version such as 0.1.2.`);
  }
  const command = cli.command;
  const prefix = cli.envPrefix;

  write(
    "apps/cli/src/keykeeper/brand.ts",
    read("apps/cli/src/keykeeper/brand.ts").replace(
      /export const CLI_BRAND: CliBrand = \{[\s\S]*?\n\};/,
      `export const CLI_BRAND: CliBrand = ${JSON.stringify(
        { name: BRAND.name, command, envPrefix: prefix, version, releases: cli.releases },
        null,
        2,
      )};`,
    ),
  );
  if (!read("apps/cli/src/keykeeper/brand.ts").includes(JSON.stringify(cli.releases))) {
    fail("apps/cli/src/keykeeper/brand.ts no longer has CLI_BRAND. Update brand/apply.mjs.");
  }

  // Help, examples, and messages everywhere in the tool: the command, the
  // product's name, and the session variable people are told to export.
  // Comments change too, which is harmless.
  const counts = { command: 0, name: 0, session: 0 };
  // "*" matches across folders in a git pathspec.
  for (const rel of trackedFiles("apps/cli/src/*.ts")) {
    // Our own files say what they mean already.
    if (/\.spec\.ts$|\/keykeeper\//.test(rel)) continue;
    const source = read(rel);
    const branded = source
      // "bw login", "| bw encode", "$ bw unlock", "\`bw send template\`", '"bw move"'.
      .replace(/\bbw(?= [a-z"-])/g, () => (counts.command++, command))
      // Not "Bitwarden_CLI/" (the user agent) nor "Bitwarden-licensed" (a comment).
      .replace(/\bBitwarden\b(?![_-])/g, () => (counts.name++, BRAND.name))
      // Saved files' names when they have none: "BitwardenAttachment-<time>".
      .replace(/\bBitwarden(?=Attachment-|SendFile-)/g, BRAND.name)
      // Example file names: "--output ./exp/bw.csv".
      .replace(/\bbw(?=\.(csv|json)\b)/g, command)
      .replace(/(export |\$env:|`)BW_SESSION\b/g, (_, before) => {
        counts.session++;
        return `${before}${prefix}SESSION`;
      });
    if (branded !== source) write(rel, branded);
  }
  if (counts.command < 100 || counts.name < 8 || counts.session < 6) {
    fail(`branded too little of the CLI (${JSON.stringify(counts)}). Upstream changed?`);
  }

  // Its data folder ("<name> CLI", from the replacement above), one next to
  // the program ("bw-data"), and the completion's command.
  const container = "apps/cli/src/service-container/service-container.ts";
  if ((read(container).match(new RegExp(`${BRAND.name} CLI"`, "g")) ?? []).length < 4) {
    fail(`${container} no longer names the data folder "Bitwarden CLI". Update brand/apply.mjs.`);
  }
  replaceAnchored(
    container,
    /path\.dirname\(process\.execPath\), "bw-data"\)/,
    `path.dirname(process.execPath), ${JSON.stringify(`${command}-data`)})`,
  );
  replaceAnchored(
    "apps/cli/src/commands/completion.command.ts",
    /this\.zshCompletion\("bw", program\)/,
    `this.zshCompletion(${JSON.stringify(command)}, program)`,
  );

  // The server: the brand's by default; "config server" with no address
  // shows it, and setting it to the brand's own address goes back to it.
  const u = BRAND.urls;
  const host = new URL(u.webVault).host;
  replaceAnchored(
    "apps/cli/src/platform/commands/config.command.ts",
    /env\.hasBaseUrl\(\) \? env\.getUrls\(\)\.base : "https:\/\/bitwarden\.com"/,
    `env.hasBaseUrl() ? env.getUrls().base : ${JSON.stringify(u.webVault)}`,
  );
  replaceAnchored(
    "apps/cli/src/platform/commands/config.command.ts",
    /url === "null" \|\| url === "bitwarden\.com" \|\| url === "https:\/\/bitwarden\.com"/,
    ["null", BRAND.domain, `https://${BRAND.domain}`, host, u.webVault, `${u.webVault}/`]
      .map((value) => `url === ${JSON.stringify(value)}`)
      .join(" || "),
  );

  // Examples and links in help and messages.
  const examples = [
    ["apps/cli/src/program.ts", /https:\/\/bitwarden\.example\.com/g, "https://vault.example.com"],
    ["apps/cli/src/program.ts", /https:\/\/bw\.company\.com/, "https://vault.company.com"],
    ["apps/cli/src/program.ts", /config server bitwarden\.com/, `config server ${BRAND.domain}`],
    [
      "apps/cli/src/program.ts",
      /https:\/\/vault\.bitwarden\.com\/#\/send\//,
      `${u.webVault}/#/send/`,
    ],
    [
      "apps/cli/src/tools/send/models/send.response.ts",
      /"https:\/\/send\.bitwarden\.com\/#"/,
      JSON.stringify(u.send),
    ],
    [
      "apps/cli/src/vault/create.command.ts",
      /https:\/\/help\.bitwarden\.com\/article\/update-encryption-key\//,
      u.help,
    ],
  ];
  for (const [rel, pattern, replacement] of examples) {
    replaceAnchored(rel, pattern, replacement);
  }

  // Export files are named after the product.
  replaceAnchored(
    "libs/tools/export-vault-core/src/services/export-helper.ts",
    /return "bitwarden" \+ \(prefix/,
    `return ${JSON.stringify(BRAND.name.toLowerCase())} + (prefix`,
  );
}

if (process.argv.includes("--revert")) revert();
else apply();
