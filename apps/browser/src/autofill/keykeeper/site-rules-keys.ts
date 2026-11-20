// Keykeeper: the public keys the extension trusts for PassBundle's own site
// rules feed (DESIGN.md, "Fill rules for everyone", "Shipping: a signed
// feed"): Ed25519 keys, as 64 lowercase hex digits, the current one and the
// next, for rotation.
//
// EMPTY ON PURPOSE. Who signs PassBundle's feed, and where its keys live, is
// the owner's open decision (DESIGN.md, "Fill rules for everyone", Decisions,
// 5). Until the owner adds a public key here, every build, a release
// included, takes no PassBundle feed: a server set to SITE_RULES_FEED=passbundle
// mirrors it, and the extension refuses it for want of a key.
//
// An operator's own feed (SITE_RULES_FEED=<url> with SITE_RULES_FEED_KEY)
// doesn't use this list: the extension learns that key from its own server,
// and those rules get site fixes' treatment (site-rules.ts).
//
// Never put a test key here, the test vectors' (docs/vectors/site-rules-v1.json)
// above all: tests hand their key to KeykeeperSiteRules themselves, and no
// build setting adds one.
export const PASSBUNDLE_SITE_RULES_KEYS: readonly string[] = Object.freeze([]);
