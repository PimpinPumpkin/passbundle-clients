import {
  anyFailsValidation,
  anyMarkedInvalid,
  changedMessages,
  confirmMessages,
  errorMessages,
  findSubmitButton,
  hasCaptcha,
  restOfFormInvalid,
  signShown,
} from "./password-change-page";

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("Keykeeper password change: what the page says", () => {
  afterEach(() => (document.body.innerHTML = ""));

  describe("CAPTCHAs", () => {
    it("knows the usual widgets and anything called a captcha", () => {
      for (const html of [
        `<div class="g-recaptcha" data-sitekey="k"></div>`,
        `<div class="h-captcha"></div>`,
        `<div class="cf-turnstile"></div>`,
        `<iframe src="https://www.example.test/recaptcha/api2/anchor"></iframe>`,
        `<iframe title="Widget containing a Cloudflare security challenge"
           src="https://challenges.cloudflare.com/x"></iframe>`,
        `<input name="captcha_answer">`,
        `<label><input type="checkbox"> I'm not a robot</label>`,
      ]) {
        expect(hasCaptcha(page(html))).toBe(true);
      }
    });

    it("isn't fooled by a plain form", () => {
      expect(
        hasCaptcha(page(`<form><input type="password" id="new"><button>Save</button></form>`)),
      ).toBe(false);
    });
  });

  describe("messages", () => {
    it("counts messages that the password changed, in the places pages say how it went", () => {
      expect(changedMessages(page(`<h1>Your password has been changed</h1>`))).toBe(1);
      expect(changedMessages(page(`<p role="status">Password updated.</p>`))).toBe(1);
      expect(
        changedMessages(page(`<div class="alert alert-success">We saved your new password</div>`)),
      ).toBe(1);
    });

    it("doesn't take a button, a link, or a hidden message for one", () => {
      expect(changedMessages(page(`<button>Change password</button><a>Update password</a>`))).toBe(
        0,
      );
      expect(changedMessages(page(`<p>Your password was changed</p>`))).toBe(0);
      expect(changedMessages(page(`<h2 hidden>Password changed</h2>`))).toBe(0);
      expect(changedMessages(page(`<h2 style="display: none">Password changed</h2>`))).toBe(0);
    });

    it("finds a message to check email or a phone", () => {
      expect(
        confirmMessages(page(`<p>We've sent you an email. Check your inbox to finish.</p>`)),
      ).toBe(2);
      expect(confirmMessages(page(`<p>Change your password below.</p>`))).toBe(0);
    });

    it("finds errors, but not messages that it worked", () => {
      const doc = page(`
        <p role="alert">Choose a password you haven't used before.</p>
        <span class="field-error"></span>
        <div class="error-summary" hidden>Old error</div>
        <div role="alert">Password changed</div>`);
      expect(errorMessages(doc)).toEqual(["Choose a password you haven't used before."]);
    });

    it("reads a field marked invalid, and the browser's own validation", () => {
      const doc = page(`
        <input type="password" id="a" aria-invalid="true">
        <input type="password" id="b" pattern="[0-9]+" value="abc">
        <input type="password" id="c" value="ok">`);
      const [a, b, c] = ["a", "b", "c"].map((id) => doc.getElementById(id));
      expect(anyMarkedInvalid([a])).toBe(true);
      expect(anyMarkedInvalid([b, c])).toBe(false);
      expect(anyFailsValidation([b])).toBe(true);
      expect(anyFailsValidation([c])).toBe(false);
    });

    it("finds what else in a form would stop it submitting", () => {
      const doc = page(`
        <form id="f">
          <input type="password" id="new" required>
          <input type="checkbox" id="agree" required>
        </form>`);
      const form = doc.getElementById("f") as HTMLFormElement;
      const ours = [doc.getElementById("new")!];
      (ours[0] as HTMLInputElement).value = "filled";
      expect(restOfFormInvalid(form, ours)).toBe(true);
      (doc.getElementById("agree") as HTMLInputElement).checked = true;
      expect(restOfFormInvalid(form, ours)).toBe(false);
      expect(restOfFormInvalid(null, ours)).toBe(false);
    });
  });

  describe("the submit button", () => {
    const newField = (doc: Document) => doc.getElementById("new")!;

    it("is the form's only submit button", () => {
      const doc = page(`<form id="f"><input type="password" id="new">
        <button type="button" aria-label="Show password"></button>
        <button>Save</button></form>`);
      const form = doc.getElementById("f") as HTMLFormElement;
      expect(findSubmitButton(form, newField(doc))?.textContent).toBe("Save");
    });

    it("is the one whose words say it saves, when there are several", () => {
      const doc = page(`<form id="f"><input type="password" id="new">
        <button>Cancel</button>
        <button id="eye"></button>
        <button>Change password</button></form>`);
      const form = doc.getElementById("f") as HTMLFormElement;
      expect(findSubmitButton(form, newField(doc))?.textContent).toBe("Change password");
    });

    it("is none when it isn't clear, so the person presses it", () => {
      const doc = page(`<form id="f"><input type="password" id="new">
        <button>Update password</button><button>Save changes</button></form>`);
      expect(
        findSubmitButton(doc.getElementById("f") as HTMLFormElement, newField(doc)),
      ).toBeNull();
      const none = page(`<form id="f"><input type="password" id="new"></form>`);
      expect(
        findSubmitButton(none.getElementById("f") as HTMLFormElement, newField(none)),
      ).toBeNull();
    });

    it("never presses a disabled or hidden button", () => {
      const doc = page(`<form id="f"><input type="password" id="new">
        <button disabled>Save</button><button hidden>Save</button></form>`);
      expect(
        findSubmitButton(doc.getElementById("f") as HTMLFormElement, newField(doc)),
      ).toBeNull();
    });

    it("looks up from fields outside a form", () => {
      const doc = page(`<div><div><input type="password" id="new"></div>
        <div role="button">Set password</div></div>`);
      expect(findSubmitButton(null, newField(doc))?.textContent).toBe("Set password");
    });
  });

  describe("a recipe's signs", () => {
    it("shows by an element, a text, or the path", () => {
      const doc = page(`<div class="done">All set</div>`);
      expect(signShown(doc, { selector: ".done" })).toBe(true);
      expect(signShown(doc, { selector: ".missing" })).toBe(false);
      expect(signShown(doc, { selector: "::not a selector" })).toBe(false);
      expect(signShown(doc, { text: "all set" })).toBe(true);
      expect(signShown(doc, { path: doc.location.pathname })).toBe(true);
      expect(signShown(doc, { path: "/elsewhere" })).toBe(false);
      expect(signShown(doc, null)).toBe(false);
    });
  });
});
