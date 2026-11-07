export default {
  "*": "prettier --cache --ignore-unknown --write",
  "*.ts": "eslint --cache --cache-strategy content --fix",
  "apps/desktop/desktop_native/**/*.rs": (stagedFiles) => {
    const relativeFiles = stagedFiles.map((f) =>
      f.replace(/^.*apps\/desktop\/desktop_native\//, ""),
    );
    // Keykeeper: formatting only. Upstream's clippy check here, and its
    // cargo-sort and cargo-udeps checks on desktop_native's Cargo.toml files,
    // don't run: we don't build or ship desktop_native (no Electron desktop
    // app), those checks compile Bitwarden's SDK crates, which our clean-room
    // rules keep our tooling from building (DESIGN.md, "Keeping up with
    // upstream"), and our CI never ran them. Keep this when resolving an
    // upstream sync.
    return [`node scripts/run-cargo-tool.mjs +nightly fmt -- ${relativeFiles.join(" ")}`];
  },
};
