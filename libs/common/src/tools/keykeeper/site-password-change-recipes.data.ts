// Keykeeper: per-site recipes for assisted password change (DESIGN.md,
// "Recipes"), for sites where the generic change-password form match isn't
// enough. Read by password-change-recipes.ts, which ignores an entry that
// isn't clean data.
//
// Empty on purpose: writing a recipe needs hands-on checks on the real site,
// and none has had them yet. Add one only with a fixture in the e2e corpus
// that reproduces the site's pattern.

/** Recipes by domain; an entry covers the domain's subdomains. */
export const SITE_PASSWORD_CHANGE_RECIPES: Readonly<Record<string, unknown>> = {};
