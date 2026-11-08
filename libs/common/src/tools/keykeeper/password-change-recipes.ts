// Keykeeper: recipes for assisted password change (DESIGN.md, "Recipes"). A
// recipe says what to do on a site where the generic change-password form
// match isn't enough: where the form is, what to press first, which fields
// and button are which, and how the site says it worked. Data only, never
// code: CSS selectors, texts, and paths, each checked here, so a recipe can't
// run anything in a page. Every rule of an assisted change still applies to a
// site with a recipe.

import { parsePasswordRules, PasswordRules } from "./password-rules";
import { SITE_PASSWORD_CHANGE_RECIPES } from "./site-password-change-recipes.data";

/** A sign on the page: an element that shows, a text that shows, or the path the tab lands on. */
export type RecipeSign = {
  selector?: string;
  text?: string;
  path?: string;
};

export type PasswordChangeRecipe = {
  /** The change-password page, on the site, over https. */
  start?: string;
  /** Buttons or links to press first, in order, as CSS selectors: one per page read, each only if it's there. */
  steps?: string[];
  /** The form's fields, by CSS selector. `current: null` is a form that doesn't ask for the current password. */
  fields?: { current?: string | null; new?: string; confirm?: string | null };
  /** The button that submits the form. */
  submit?: string;
  /** How the site says the password changed. */
  changed?: RecipeSign;
  /** How the site says it refused the new password. */
  refused?: RecipeSign;
  /** Password rules in Apple's password rules language, for a site Apple's list doesn't have. */
  rules?: string;
};

const MAX_SELECTOR = 300;
const MAX_TEXT = 200;
const MAX_STEPS = 5;

/** A CSS selector a recipe may hold: a short string, without anything that could be markup or script. */
function isSelector(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_SELECTOR &&
    !/[<>{}]|javascript:/i.test(value)
  );
}

const isText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim() !== "" &&
  value.length <= MAX_TEXT &&
  !/[<>]/.test(value);

const isPath = (value: unknown): value is string =>
  typeof value === "string" && /^\/[^\s<>]{0,199}$/.test(value);

function readSign(value: unknown): RecipeSign | null | undefined {
  if (value == null) {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  if (typeof v !== "object" || Array.isArray(v)) {
    return null;
  }
  const sign: RecipeSign = {};
  for (const key of Object.keys(v)) {
    if (key === "selector" && isSelector(v.selector)) {
      sign.selector = v.selector;
    } else if (key === "text" && isText(v.text)) {
      sign.text = v.text;
    } else if (key === "path" && isPath(v.path)) {
      sign.path = v.path;
    } else {
      return null;
    }
  }
  return Object.keys(sign).length > 0 ? sign : null;
}

/**
 * Reads a recipe, or null when anything in it isn't clean data of the right
 * kind: one bad part and the whole recipe is ignored, so a half-read recipe
 * never steers a change.
 */
export function readRecipe(value: unknown): PasswordChangeRecipe | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const recipe: PasswordChangeRecipe = {};
  for (const key of Object.keys(v)) {
    switch (key) {
      case "start": {
        let url: URL;
        try {
          url = new URL(String(v.start));
        } catch {
          return null;
        }
        if (
          typeof v.start !== "string" ||
          url.protocol !== "https:" ||
          url.username ||
          url.password
        ) {
          return null;
        }
        recipe.start = url.href;
        break;
      }
      case "steps":
        if (
          !Array.isArray(v.steps) ||
          v.steps.length > MAX_STEPS ||
          !v.steps.every((s) => isSelector(s))
        ) {
          return null;
        }
        recipe.steps = [...(v.steps as string[])];
        break;
      case "fields": {
        const f = v.fields as Record<string, unknown>;
        if (f == null || typeof f !== "object" || Array.isArray(f)) {
          return null;
        }
        const fields: PasswordChangeRecipe["fields"] = {};
        for (const name of Object.keys(f)) {
          if (name === "new" && isSelector(f.new)) {
            fields.new = f.new;
          } else if (
            (name === "current" || name === "confirm") &&
            (f[name] === null || isSelector(f[name]))
          ) {
            fields[name] = f[name] as string | null;
          } else {
            return null;
          }
        }
        recipe.fields = fields;
        break;
      }
      case "submit":
        if (!isSelector(v.submit)) {
          return null;
        }
        recipe.submit = v.submit;
        break;
      case "changed":
      case "refused": {
        const sign = readSign(v[key]);
        if (sign == null) {
          return null;
        }
        recipe[key] = sign;
        break;
      }
      case "rules":
        if (
          typeof v.rules !== "string" ||
          v.rules.length > 500 ||
          parsePasswordRules(v.rules) == null
        ) {
          return null;
        }
        recipe.rules = v.rules;
        break;
      default:
        return null;
    }
  }
  return recipe;
}

/** The recipe for a page's host (any port is ignored), from the site's own entry or its parent domain's. */
export function recipeForHost(
  host: string | null | undefined,
  table: Readonly<Record<string, unknown>> = SITE_PASSWORD_CHANGE_RECIPES,
): PasswordChangeRecipe | null {
  const labels = (host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const domain = labels.slice(i).join(".");
    if (Object.prototype.hasOwnProperty.call(table, domain)) {
      return readRecipe(table[domain]);
    }
  }
  return null;
}

/** A recipe's own password rules, read. */
export function recipeRules(recipe: PasswordChangeRecipe | null | undefined): PasswordRules | null {
  return recipe?.rules == null ? null : parsePasswordRules(recipe.rules);
}
