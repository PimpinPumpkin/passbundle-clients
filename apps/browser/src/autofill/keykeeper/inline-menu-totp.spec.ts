import { inlineMenuTotp, MASKED_TOTP } from "./inline-menu-totp";

describe("inlineMenuTotp", () => {
  it("shows the code to someone who can see the item's passwords", () => {
    expect(inlineMenuTotp({ viewPassword: true }, "123456")).toBe("123456");
  });

  it("shows a mask instead to someone who can't, so the item is still offered to fill", () => {
    expect(inlineMenuTotp({ viewPassword: false }, "123456")).toBe(MASKED_TOTP);
    // An item that doesn't say is hidden.
    expect(inlineMenuTotp({}, "123456")).toBe(MASKED_TOTP);
    expect(MASKED_TOTP).not.toMatch(/\d/);
  });

  it("shows nothing without a code", () => {
    expect(inlineMenuTotp({ viewPassword: false }, undefined)).toBeUndefined();
    expect(inlineMenuTotp({ viewPassword: true }, "")).toBeUndefined();
  });
});
