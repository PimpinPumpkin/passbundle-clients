import {
  PasswordChangeRecipe,
  readRecipe,
  recipeForHost,
  recipeRules,
} from "./password-change-recipes";
import { SITE_PASSWORD_CHANGE_RECIPES } from "./site-password-change-recipes.data";

const full: PasswordChangeRecipe = {
  start: "https://accounts.example.test/settings/password",
  steps: ["#security-tab", "button.change-password"],
  fields: { current: "#old", new: "#new", confirm: null },
  submit: "form#change button[type=submit]",
  changed: { text: "All set" },
  refused: { selector: ".form-error" },
  rules: "minlength: 12; required: digit;",
};

describe("Keykeeper password change recipes", () => {
  it("ships none: each needs hands-on checks on the real site first", () => {
    expect(Object.keys(SITE_PASSWORD_CHANGE_RECIPES)).toHaveLength(0);
  });

  it("reads a recipe of clean data", () => {
    expect(readRecipe(full)).toEqual(full);
    expect(recipeRules(readRecipe(full))?.minLength).toBe(12);
  });

  it("finds a site's recipe by its domain or a parent's", () => {
    const table = { "example.test": { submit: "#save" } };
    expect(recipeForHost("accounts.example.test", table)).toEqual({ submit: "#save" });
    expect(recipeForHost("example.test:8443", table)).toEqual({ submit: "#save" });
    expect(recipeForHost("example.org", table)).toBeNull();
    // An entry named like an object's own property is still only data.
    expect(recipeForHost("constructor.test", {})).toBeNull();
  });

  it("ignores a whole recipe when any part of it isn't clean data", () => {
    const bad = [
      { start: "http://accounts.example.test/password" },
      { start: "https://user:pass@accounts.example.test/" },
      { start: "javascript:alert(1)" },
      { steps: "#one" },
      { steps: Array(6).fill("#one") },
      { steps: ["<img src=x>"] },
      { submit: "a".repeat(301) },
      { submit: "javascript:void(0)" },
      { fields: { new: "#new", extra: "#x" } },
      { fields: { current: 1, new: "#new" } },
      { changed: { text: "<b>ok</b>" } },
      { changed: { path: "no-slash" } },
      { changed: { run: "doSomething()" } },
      { changed: {} },
      { rules: "required: [abc" },
      { script: "alert(1)" },
      ["#array"],
      "a string",
    ];
    for (const recipe of bad) {
      expect(readRecipe(recipe)).toBeNull();
    }
    expect(recipeForHost("accounts.example.test", { "example.test": { submit: "{}" } })).toBeNull();
  });

  it("can say a form has no current-password field", () => {
    expect(readRecipe({ fields: { current: null, new: "#new" } })?.fields).toEqual({
      current: null,
      new: "#new",
    });
  });
});
