import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DIALOG_DATA, DialogService } from "@bitwarden/components";

import { attachingOffSentence, KeykeeperPlanSentence, pricingPageAddress } from "./plan-notice";
import { KeykeeperPlanNoticeDialogComponent } from "./plan-notice-dialog.component";
import { KeykeeperPlanNoticeComponent } from "./plan-notice.component";

const messages: Record<string, string> = {
  keykeeperPlanPremium: "That's part of Premium.",
  keykeeperPlanAttachFiles: "Attaching files is part of Premium.",
  keykeeperPlanBreachReport: "The data breach report is part of Premium.",
  keykeeperPlanOrganizationEnded:
    "This organization's plan has ended, so nothing new can be added. Everything in it can still be opened, changed, exported, and deleted.",
  keykeeperPlanSeePricing: "See pricing",
  keykeeperPlanPremiumTitle: "Premium",
  keykeeperPlanEndedTitle: "Plan ended",
  close: "Close",
};

function i18n(pricingPage: string | undefined) {
  return {
    t: (key: string) => (key === "keykeeperPricingPage" ? (pricingPage ?? key) : messages[key]),
    translate: (key: string) => messages[key],
  };
}

describe("pricingPageAddress", () => {
  it("keeps an https address", () => {
    expect(pricingPageAddress("https://example.com/pricing/")).toBe("https://example.com/pricing/");
  });

  it.each([
    ["an http address", "http://example.com/pricing/"],
    ["a script address", "javascript:alert(1)"],
    ["a missing message, which comes back as its key", "keykeeperPricingPage"],
    ["an empty message", ""],
    ["nothing", undefined],
    ["null", null],
  ])("has no address for %s", (_name, message) => {
    expect(pricingPageAddress(message)).toBeNull();
  });
});

describe("attachingOffSentence", () => {
  it("says attaching files is part of Premium for a personal item", () => {
    expect(attachingOffSentence("premium")).toBe(KeykeeperPlanSentence.AttachFiles);
  });

  it("says the plan has ended for an organization without storage", () => {
    expect(attachingOffSentence("organization")).toBe(KeykeeperPlanSentence.OrganizationEnded);
  });
});

describe("KeykeeperPlanNoticeComponent", () => {
  let fixture: ComponentFixture<KeykeeperPlanNoticeComponent>;

  async function render(sentence: KeykeeperPlanSentence, pricingPage?: string) {
    await TestBed.configureTestingModule({
      imports: [KeykeeperPlanNoticeComponent],
      providers: [{ provide: I18nService, useValue: i18n(pricingPage) }],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperPlanNoticeComponent);
    fixture.componentRef.setInput("sentence", sentence);
    fixture.detectChanges();
  }

  const link = () => fixture.debugElement.query(By.css('[data-testid="keykeeper-pricing-link"]'));

  it("says the sentence and links to the Pricing page in a new tab", async () => {
    await render(KeykeeperPlanSentence.AttachFiles, "https://example.com/pricing/");

    expect(fixture.nativeElement.textContent).toContain("Attaching files is part of Premium.");
    const anchor = link().nativeElement as HTMLAnchorElement;
    expect(anchor.textContent?.trim()).toBe("See pricing");
    expect(anchor.getAttribute("href")).toBe("https://example.com/pricing/");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noreferrer");
  });

  it("names the sentence for tests and other tools", async () => {
    await render(KeykeeperPlanSentence.BreachReport, "https://example.com/pricing/");

    const notice = fixture.debugElement.query(By.css('[data-testid="keykeeper-plan-notice"]'));
    expect(notice.nativeElement.getAttribute("data-sentence")).toBe("keykeeperPlanBreachReport");
    expect(notice.nativeElement.textContent).toContain(
      "The data breach report is part of Premium.",
    );
  });

  it("leaves the link out when the build has no https address for the website", async () => {
    await render(KeykeeperPlanSentence.Premium, "http://example.com/pricing/");

    expect(fixture.nativeElement.textContent).toContain("That's part of Premium.");
    expect(link()).toBeNull();
  });

  it("leaves the link out when the message is missing", async () => {
    await render(KeykeeperPlanSentence.Premium);

    expect(link()).toBeNull();
  });
});

describe("KeykeeperPlanNoticeDialogComponent", () => {
  async function render(sentence: KeykeeperPlanSentence) {
    await TestBed.configureTestingModule({
      imports: [KeykeeperPlanNoticeDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: I18nService, useValue: i18n("https://example.com/pricing/") },
        { provide: DIALOG_DATA, useValue: { sentence } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KeykeeperPlanNoticeDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it("is titled Premium and says the sentence", async () => {
    const fixture = await render(KeykeeperPlanSentence.AttachFiles);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("Premium");
    expect(text).toContain("Attaching files is part of Premium.");
    expect(text).toContain("See pricing");
    expect(text).toContain("Close");
  });

  it("is titled Plan ended for an organization whose plan has ended", async () => {
    const fixture = await render(KeykeeperPlanSentence.OrganizationEnded);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("Plan ended");
    expect(text).toContain("This organization's plan has ended, so nothing new can be added.");
  });

  it("opens centered with the sentence it was given", () => {
    const dialogService = { open: jest.fn().mockReturnValue("ref") };

    const ref = KeykeeperPlanNoticeDialogComponent.open(dialogService as unknown as DialogService, {
      sentence: KeykeeperPlanSentence.BreachReport,
    });

    expect(ref).toBe("ref");
    expect(dialogService.open).toHaveBeenCalledWith(
      KeykeeperPlanNoticeDialogComponent,
      expect.objectContaining({ data: { sentence: KeykeeperPlanSentence.BreachReport } }),
    );
  });
});
