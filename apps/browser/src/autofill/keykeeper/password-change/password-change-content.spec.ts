import AutofillField from "../../models/autofill-field";
import AutofillScript from "../../models/autofill-script";

import { PasswordChangeContent, PageServices } from "./password-change-content";
import {
  FillAnswer,
  PAGE_FILL,
  PAGE_NOTE,
  PAGE_READ,
  PAGE_STEP,
  PAGE_WATCH,
  PageReading,
} from "./password-change-messages";

const url = () => document.location.href;

/** Stands in for upstream's collection and fill: every input, by an opid on the element. */
function services(): PageServices & { fills: AutofillScript[] } {
  const elements = new Map<string, HTMLInputElement>();
  const fills: AutofillScript[] = [];
  return {
    fills,
    collect: {
      getPageDetails: async () => {
        elements.clear();
        const fields = Array.from(document.querySelectorAll("input")).map((input, i) => {
          const opid = `__${i}`;
          elements.set(opid, input);
          return {
            opid,
            elementNumber: i,
            viewable: true,
            htmlID: input.id || null,
            htmlName: input.name || null,
            type: input.type,
            autoCompleteType: input.getAttribute("autocomplete"),
            "label-tag": Array.from(input.labels ?? [])
              .map((l) => l.textContent)
              .join(" "),
            form: input.form?.id ?? null,
            readonly: input.readOnly,
            disabled: input.disabled,
          } as unknown as AutofillField;
        });
        return { fields };
      },
      getAutofillFieldElementByOpid: (opid) => elements.get(opid) ?? null,
    },
    insert: {
      fillForm: async (script) => {
        fills.push(script);
        for (const [action, opid, value] of script.script) {
          if (action === "fill_by_opid") {
            elements.get(opid)!.value = value!;
          }
        }
      },
    },
  };
}

const FORM = `
  <form id="change" action="/cp/submit" method="post">
    <label for="current">Current password</label>
    <input type="password" id="current" autocomplete="current-password">
    <label for="new">New password</label>
    <input type="password" id="new" autocomplete="new-password" maxlength="20" minlength="12"
      passwordrules="required: digit; allowed: lower, upper;">
    <label for="confirm">Confirm new password</label>
    <input type="password" id="confirm" autocomplete="new-password">
    <button type="submit" id="save">Change password</button>
  </form>`;

describe("Keykeeper password change: the page's half", () => {
  let content: PasswordChangeContent;
  let fake: ReturnType<typeof services>;
  let submitted: jest.Mock;

  beforeEach(() => {
    document.body.innerHTML = FORM;
    fake = services();
    // jsdom doesn't submit forms; the tests only need to know one was.
    submitted = jest.fn((event: Event) => event.preventDefault());
    document.addEventListener("submit", submitted);
    content = new PasswordChangeContent(
      document,
      () => fake,
      jest.fn(),
      () => true,
    );
  });

  afterEach(() => {
    document.removeEventListener("submit", submitted);
    document.body.innerHTML = "";
    jest.useRealTimers();
  });

  const read = () =>
    content.handle({
      command: PAGE_READ,
      url: url(),
      recipe: null,
      step: 0,
    }) as Promise<PageReading>;
  const fill = (submit: boolean, next = "Newpassword123") =>
    content.handle({
      command: PAGE_FILL,
      url: url(),
      current: "old-password",
      next,
      submit,
      recipe: null,
    }) as Promise<FillAnswer>;

  it("reads the form, its fields' rules, and its button", async () => {
    const reading = await read();
    expect(reading).toMatchObject({
      url: url(),
      form: "form",
      captcha: false,
      codeField: false,
      submitButton: true,
      filledHere: false,
    });
    expect(reading.rules[0]).toEqual({
      passwordRules: "required: digit; allowed: lower, upper;",
      minLength: 12,
      maxLength: 20,
    });
  });

  it("answers a request for another address with where it is, and does nothing", async () => {
    const answer = await content.handle({
      command: PAGE_FILL,
      url: "https://elsewhere.example.test/",
      current: "old",
      next: "new",
      submit: true,
      recipe: null,
    });
    expect(answer).toEqual({ url: url(), mismatch: true });
    expect(fake.fills).toHaveLength(0);
  });

  it("answers nothing for messages that aren't its own", () => {
    expect(content.handle({ command: "fillForm" })).toBeNull();
    expect(content.handle(null)).toBeNull();
  });

  it("fills the current password and the new one twice, then presses the button", async () => {
    await read();
    const answer = await fill(true);
    expect(answer).toEqual({
      url: url(),
      filled: true,
      invalid: false,
      restInvalid: false,
      submitted: true,
    });
    expect((document.getElementById("current") as HTMLInputElement).value).toBe("old-password");
    expect((document.getElementById("new") as HTMLInputElement).value).toBe("Newpassword123");
    expect((document.getElementById("confirm") as HTMLInputElement).value).toBe("Newpassword123");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("fills without pressing when it hands over", async () => {
    await read();
    expect((await fill(false)).submitted).toBe(false);
    expect(submitted).not.toHaveBeenCalled();
  });

  it("doesn't press when the form's own rules turn the new password down", async () => {
    document.getElementById("new")!.setAttribute("pattern", "[0-9]+");
    await read();
    const answer = await fill(true);
    expect(answer).toMatchObject({ filled: true, invalid: true, submitted: false });
    expect(submitted).not.toHaveBeenCalled();
  });

  it("doesn't press when something else in the form must be filled first", async () => {
    document
      .getElementById("save")!
      .insertAdjacentHTML("beforebegin", `<input type="checkbox" id="robot" required>`);
    await read();
    expect(await fill(true)).toMatchObject({ filled: true, restInvalid: true, submitted: false });
    expect(submitted).not.toHaveBeenCalled();
  });

  it("doesn't press when a value didn't stay in its field", async () => {
    await read();
    fake.insert.fillForm = async () => {};
    expect(await fill(true)).toMatchObject({ filled: false, submitted: false });
    expect(submitted).not.toHaveBeenCalled();
  });

  it("fills nothing without a form from the last read, or once it's gone", async () => {
    expect(await fill(true)).toMatchObject({ filled: false });
    await read();
    document.getElementById("change")!.remove();
    expect(await fill(true)).toMatchObject({ filled: false });
    expect(fake.fills).toHaveLength(0);
  });

  describe("watching for the result", () => {
    const watch = (ms = 5_000) =>
      content.handle({ command: PAGE_WATCH, url: url(), ms, recipe: null }) as Promise<PageReading>;

    beforeEach(async () => {
      await read();
      await fill(true);
    });

    it("sees a message that the password changed", async () => {
      const result = watch();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<p role="status">Your password was changed.</p>`,
      );
      expect(await result).toMatchObject({ changedMessage: true, filledHere: true });
    });

    it("counts only messages that weren't there at the fill", async () => {
      document.body.innerHTML = `<h2>Password changed 2 years ago</h2>` + FORM;
      fake = services();
      content = new PasswordChangeContent(
        document,
        () => fake,
        jest.fn(),
        () => true,
      );
      await read();
      await fill(true);
      jest.useFakeTimers();
      const result = watch(1_000);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(await result).toMatchObject({ changedMessage: false, form: "form" });
    });

    it("sees an error and a field marked invalid", async () => {
      const result = watch();
      document.getElementById("new")!.setAttribute("aria-invalid", "true");
      document.body.insertAdjacentHTML(
        "beforeend",
        `<p role="alert">Too much like your old one.</p>`,
      );
      expect(await result).toMatchObject({ errorMessage: true, invalidField: true, form: "form" });
    });

    it("sees a code to enter or a CAPTCHA that showed up", async () => {
      const result = watch();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<label for="otp">Code from your app</label><input id="otp" autocomplete="one-time-code">`,
      );
      expect(await result).toMatchObject({ codeField: true });
    });

    it("gives a form that went away a moment, then answers without a sign", async () => {
      jest.useFakeTimers();
      const result = watch(30_000);
      document.getElementById("change")!.remove();
      await jest.advanceTimersByTimeAsync(2_500);
      expect(await result).toMatchObject({
        form: "none",
        changedMessage: false,
        errorMessage: false,
      });
    });
  });

  it("presses a recipe's step only when it's there", async () => {
    document.body.insertAdjacentHTML("beforeend", `<a id="go" href="#settings">Security</a>`);
    const clicked = jest.fn();
    document.getElementById("go")!.addEventListener("click", clicked);
    const recipe = { steps: ["#go", "#missing"] };
    expect(await content.handle({ command: PAGE_STEP, url: url(), recipe, step: 0 })).toEqual({
      clicked: true,
    });
    expect(await content.handle({ command: PAGE_STEP, url: url(), recipe, step: 1 })).toEqual({
      clicked: false,
    });
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("finds a recipe's fields by selector, including a form without a current password", async () => {
    document.body.innerHTML = `<form id="f"><input type="password" id="a"><input type="password" id="b">
      <button>Go</button></form>`;
    const recipe = { fields: { current: null, new: "#a", confirm: "#b" }, submit: "button" };
    const reading = (await content.handle({
      command: PAGE_READ,
      url: url(),
      recipe,
      step: 0,
    })) as PageReading;
    expect(reading).toMatchObject({ form: "form", submitButton: true });
    const answer = (await content.handle({
      command: PAGE_FILL,
      url: url(),
      current: "unused",
      next: "Newpassword123",
      submit: false,
      recipe,
    })) as FillAnswer;
    expect(answer.filled).toBe(true);
    expect((document.getElementById("a") as HTMLInputElement).value).toBe("Newpassword123");
    expect((document.getElementById("b") as HTMLInputElement).value).toBe("Newpassword123");
  });

  it("ignores a recipe's field that isn't a password field", async () => {
    document.body.innerHTML = `<form id="f"><input type="text" id="a"></form>`;
    const recipe = { fields: { current: null, new: "#a" } };
    const reading = (await content.handle({
      command: PAGE_READ,
      url: url(),
      recipe,
      step: 0,
    })) as PageReading;
    expect(reading.form).toBe("none");
  });

  it("shows a note as text in a closed shadow root, without buttons", async () => {
    await content.handle({ command: PAGE_NOTE, title: "Password change", text: "<b>Saving</b>" });
    const host = document.body.lastElementChild as HTMLElement;
    // Closed: the page can't reach into it.
    expect(host.shadowRoot).toBeNull();
    expect(document.querySelectorAll("button")).toHaveLength(1);
    await content.handle({ command: PAGE_NOTE, title: "Password change", text: null });
    expect(document.body.contains(host)).toBe(false);
  });
});
