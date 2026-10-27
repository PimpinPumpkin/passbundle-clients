// PassBundle's own browser extensions, whose pages may host a connector page
// besides the web vault itself (see allowedParentOrigin in common.ts).
// brand/apply.mjs fills this in at build time from brand.json's extension
// IDs, so an unbranded build answers the web vault only. The server lets the
// same extensions frame connector pages (DESIGN.md, "Connector pages").
export const EXTENSION_ORIGINS: readonly string[] = [];
