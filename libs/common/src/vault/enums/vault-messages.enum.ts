// Keykeeper: the web vault and the extension talk through page messages that
// any extension on the page can send or hear. Upstream's names would let
// Bitwarden's own extension pass for ours (the web vault said "extension
// installed" when only Bitwarden's was) and answer our web vault, so ours
// have names of their own.
const VaultMessages = {
  HasBwInstalled: "keykeeper.hasBwInstalled",
  checkBwInstalled: "keykeeper.checkIfBWExtensionInstalled",
  /** @deprecated use {@link OpenBrowserExtensionToUrl} */
  OpenAtRiskPasswords: "keykeeper.openAtRiskPasswords",
  OpenBrowserExtensionToUrl: "keykeeper.openBrowserExtensionToUrl",
  PopupOpened: "keykeeper.popupOpened",
} as const;

export { VaultMessages };
