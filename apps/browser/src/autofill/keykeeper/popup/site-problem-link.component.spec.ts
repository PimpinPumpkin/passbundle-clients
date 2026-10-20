import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { BehaviorSubject } from "rxjs";

import { VaultPopupAutofillService } from "../../../vault/popup/services/vault-popup-autofill.service";

import { KeykeeperSiteProblemLinkComponent } from "./site-problem-link.component";

describe("KeykeeperSiteProblemLinkComponent", () => {
  let fixture: ComponentFixture<KeykeeperSiteProblemLinkComponent>;
  const currentAutofillTab$ = new BehaviorSubject<Partial<chrome.tabs.Tab> | null>(null);

  const link = () =>
    fixture.nativeElement.querySelector(
      "[data-testid=current-tab-site-problem-link]",
    ) as HTMLAnchorElement | null;

  async function showTab(tab: Partial<chrome.tabs.Tab> | null) {
    currentAutofillTab$.next(tab);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KeykeeperSiteProblemLinkComponent],
      providers: [
        provideRouter([]),
        { provide: VaultPopupAutofillService, useValue: { currentAutofillTab$ } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperSiteProblemLinkComponent);
  });

  it("links to the report page for the current website's tab", async () => {
    await showTab({ id: 42, url: "https://bank.example/login" });

    expect(link()?.textContent).toContain("Report a problem with this site");
    expect(link()?.getAttribute("href")).toBe("/keykeeper-site-problem?tabId=42");
  });

  it("names a tab whose id is 0", async () => {
    await showTab({ id: 0, url: "http://intranet.example/" });

    expect(link()?.getAttribute("href")).toBe("/keykeeper-site-problem?tabId=0");
  });

  it.each([
    ["no tab (a popout without one)", null],
    ["a browser page", { id: 7, url: "chrome://settings/" }],
    ["an extension page", { id: 7, url: "chrome-extension://abc/popup/index.html" }],
    ["a tab without an id", { url: "https://bank.example/" }],
  ])("isn't shown for %s", async (_, tab) => {
    await showTab(tab);

    expect(link()).toBeNull();
  });
});
