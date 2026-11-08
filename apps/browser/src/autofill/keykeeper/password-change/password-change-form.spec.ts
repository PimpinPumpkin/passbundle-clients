import AutofillField from "../../models/autofill-field";

import { findChangePasswordForm, roleOf } from "./password-change-form";

let nextOpid = 0;

/** A field as upstream's collection describes it: a shown password field in form f1 unless said otherwise. */
function field(props: Partial<AutofillField> = {}): AutofillField {
  return {
    opid: `__${nextOpid++}`,
    elementNumber: nextOpid,
    viewable: true,
    htmlID: null,
    htmlName: null,
    htmlClass: null,
    tabindex: null,
    title: null,
    type: "password",
    form: "f1",
    ...props,
  } as AutofillField;
}

describe("Keykeeper password change: the change-password form", () => {
  beforeEach(() => (nextOpid = 0));

  it("finds current, new, and confirm by their autocomplete tokens", () => {
    const fields = [
      field({ autoCompleteType: "current-password" }),
      field({ autoCompleteType: "new-password" }),
      field({ autoCompleteType: "new-password", "label-tag": "Confirm new password" }),
    ];
    expect(findChangePasswordForm(fields)).toEqual({
      kind: "form",
      plan: { form: "f1", current: "__0", new: "__1", confirm: "__2" },
      codeField: false,
    });
  });

  it("reads the field's own words: id, name, and label", () => {
    expect(roleOf(field({ htmlID: "oldPassword" }))).toBe("current");
    expect(roleOf(field({ htmlName: "current_password" }))).toBe("current");
    expect(roleOf(field({ htmlID: "newPassword" }))).toBe("new");
    expect(roleOf(field({ "label-tag": "Re-enter new password" }))).toBe("confirm");
    expect(roleOf(field({ placeholder: "Repeat password" }))).toBe("confirm");
    expect(roleOf(field({ htmlID: "pw2" }))).toBeNull();
  });

  it("doesn't read the text before a field, which can be the previous field's label", () => {
    expect(roleOf(field({ htmlID: "newPassword", "label-left": "Current password" }))).toBe("new");
  });

  it("takes three unlabeled password fields in the usual order", () => {
    const reading = findChangePasswordForm([field(), field(), field()]);
    expect(reading).toEqual({
      kind: "form",
      plan: { form: "f1", current: "__0", new: "__1", confirm: "__2" },
      codeField: false,
    });
  });

  it("fills the one gap the order leaves no doubt about", () => {
    const reading = findChangePasswordForm([
      field({ htmlID: "current" }),
      field(),
      field({ htmlID: "confirm" }),
    ]);
    expect(reading).toMatchObject({
      kind: "form",
      plan: { current: "__0", new: "__1", confirm: "__2" },
    });
  });

  it("takes a current and a new field without a confirm field", () => {
    const reading = findChangePasswordForm([
      field({ autoCompleteType: "current-password" }),
      field({ autoCompleteType: "new-password" }),
    ]);
    expect(reading).toMatchObject({
      kind: "form",
      plan: { current: "__0", new: "__1", confirm: null },
    });
  });

  it("never takes two unlabeled fields: new and confirm look like current and new", () => {
    expect(findChangePasswordForm([field(), field()]).kind).toBe("ambiguous");
  });

  it("stops at a form without a current-password field: a sign-up, or someone else's account", () => {
    expect(
      findChangePasswordForm([
        field({ autoCompleteType: "new-password" }),
        field({ autoCompleteType: "new-password", htmlID: "confirm" }),
      ]).kind,
    ).toBe("noCurrent");
    expect(findChangePasswordForm([field({ autoCompleteType: "new-password" })]).kind).toBe(
      "noCurrent",
    );
  });

  it("stops at two forms that could each be it", () => {
    const reading = findChangePasswordForm([
      field({ form: "a", autoCompleteType: "current-password" }),
      field({ form: "a", autoCompleteType: "new-password" }),
      field({ form: "b", autoCompleteType: "current-password" }),
      field({ form: "b", autoCompleteType: "new-password" }),
    ]);
    expect(reading.kind).toBe("ambiguous");
  });

  it("stops at a form with another password field it can't place", () => {
    const reading = findChangePasswordForm([
      field({ autoCompleteType: "current-password" }),
      field({ autoCompleteType: "new-password" }),
      field({ htmlID: "confirm" }),
      field({ htmlID: "pin" }),
    ]);
    expect(reading.kind).toBe("ambiguous");
    expect(
      findChangePasswordForm([
        field({ autoCompleteType: "current-password" }),
        field({ autoCompleteType: "current-password" }),
        field({ autoCompleteType: "new-password" }),
      ]).kind,
    ).toBe("ambiguous");
  });

  it("only counts password fields a person could type in", () => {
    const reading = findChangePasswordForm([
      field({ autoCompleteType: "current-password" }),
      field({ autoCompleteType: "new-password" }),
      field({ autoCompleteType: "new-password", htmlID: "confirm" }),
      // A hidden copy, a read-only one, a disabled one, and a text field.
      field({ autoCompleteType: "new-password", viewable: false }),
      field({ htmlID: "x", readonly: true }),
      field({ htmlID: "y", disabled: true }),
      field({ type: "text", htmlID: "newPassword" }),
    ]);
    expect(reading).toMatchObject({
      kind: "form",
      plan: { current: "__0", new: "__1", confirm: "__2" },
    });
  });

  it("says when the form also asks for a one-time code", () => {
    const reading = findChangePasswordForm([
      field({ autoCompleteType: "current-password" }),
      field({ autoCompleteType: "new-password" }),
      field({ type: "text", autoCompleteType: "one-time-code", htmlID: "otp" }),
    ]);
    expect(reading).toMatchObject({ kind: "form", codeField: true });
  });

  it("takes fields outside any form as one group", () => {
    const reading = findChangePasswordForm([
      field({ form: null, autoCompleteType: "current-password" }),
      field({ form: null, autoCompleteType: "new-password" }),
    ]);
    expect(reading).toMatchObject({ kind: "form", plan: { form: null } });
  });

  it("tells a sign-in form apart, and a page with no form", () => {
    expect(
      findChangePasswordForm([
        field({ type: "email", htmlID: "email", autoCompleteType: "username" }),
        field({ autoCompleteType: "current-password" }),
      ]).kind,
    ).toBe("signIn");
    expect(findChangePasswordForm([field({ type: "search", htmlID: "q" })]).kind).toBe("none");
    expect(findChangePasswordForm([]).kind).toBe("none");
  });
});
