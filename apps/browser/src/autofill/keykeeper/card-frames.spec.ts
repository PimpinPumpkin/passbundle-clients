import { cardMayFillFrame, isPagesOwnSite, isPaymentServiceFrame } from "./card-frames";

describe("payment services' frames", () => {
  it("are the listed services' card fields, over HTTPS", () => {
    for (const url of [
      "https://js.stripe.com/v3/elements-inner-card.html",
      "https://b.js.stripe.com/v3/elements-inner-card.html",
      "https://checkout.stripe.com/c/pay/cs_test",
      "https://assets.braintreegateway.com/web/3.0.0/html/hosted-fields-frame.min.html",
      "https://checkoutshopper-live.adyen.com/checkoutshopper/securedfields/x/securedFields.html",
      "https://checkoutshopper-live-us.cdn.adyen.com/checkoutshopper/securedfields.html",
      "https://checkoutshopper-test.adyen.com/checkoutshopper/securedfields.html",
      "https://web.squarecdn.com/v1/card.html",
      "https://sandbox.web.squarecdn.com/v1/card.html",
    ]) {
      expect([url, isPaymentServiceFrame(url)]).toEqual([url, true]);
    }
  });

  it("are never a look-alike host, another of their hosts, plain HTTP, or no address", () => {
    for (const url of [
      "http://js.stripe.com/v3/elements-inner-card.html",
      "https://js.stripe.com.pay.example/card.html",
      "https://evil-js.stripe.com.example/card.html",
      "https://stripe.com/card.html",
      "https://dashboard.stripe.com/card.html",
      "https://notjs.stripe.com/card.html",
      "https://checkoutshopper-live.adyen.com.example/securedfields.html",
      "https://adyen.com/securedfields.html",
      "https://squarecdn.com/card.html",
      "about:blank",
      "",
      null,
    ]) {
      expect([url, isPaymentServiceFrame(url)]).toEqual([url, false]);
    }
  });
});

describe("the page's own site", () => {
  it("is the same registrable domain as the tab's", () => {
    expect(
      isPagesOwnSite("https://pay.shop.example.test/x", "https://shop.example.test/checkout"),
    ).toBe(true);
    expect(isPagesOwnSite("https://shop.example.test/x", "https://shop.example.test/")).toBe(true);
    expect(isPagesOwnSite("https://pay.elsewhere.test/x", "https://shop.example.test/")).toBe(
      false,
    );
    // Another shop on the same hosting service is another site.
    expect(isPagesOwnSite("https://other.myshopify.com/", "https://mine.myshopify.com/")).toBe(
      false,
    );
    expect(isPagesOwnSite("about:blank", "https://shop.example.test/")).toBe(false);
    expect(isPagesOwnSite(null, "https://shop.example.test/")).toBe(false);
  });
});

describe("the frames a card fills", () => {
  const tabUrl = "https://shop.example.test/checkout";

  it("are the page, its own site's frames, the frame the fill started in, and payment services' frames", () => {
    expect(cardMayFillFrame({ frameId: 0, frameUrl: tabUrl, tabUrl })).toBe(true);
    expect(
      cardMayFillFrame({ frameId: 3, frameUrl: "https://pay.example.test/card", tabUrl }),
    ).toBe(true);
    expect(
      cardMayFillFrame({ frameId: 4, frameUrl: "https://js.stripe.com/v3/card.html", tabUrl }),
    ).toBe(true);
    expect(
      cardMayFillFrame({
        frameId: 5,
        frameUrl: "https://widget.elsewhere.test/card",
        tabUrl,
        startedInFrameId: 5,
      }),
    ).toBe(true);
  });

  it("are never another site's frame the fill didn't start in", () => {
    expect(
      cardMayFillFrame({ frameId: 5, frameUrl: "https://widget.elsewhere.test/card", tabUrl }),
    ).toBe(false);
    expect(
      cardMayFillFrame({
        frameId: 5,
        frameUrl: "https://widget.elsewhere.test/card",
        tabUrl,
        startedInFrameId: 0,
      }),
    ).toBe(false);
    expect(cardMayFillFrame({ frameId: 6, frameUrl: "about:blank", tabUrl })).toBe(false);
  });
});
