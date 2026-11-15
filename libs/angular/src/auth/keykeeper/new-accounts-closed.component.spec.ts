import { ComponentFixture, TestBed } from "@angular/core/testing";
import { BehaviorSubject } from "rxjs";

import {
  Environment,
  EnvironmentService,
  Region,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import {
  KeykeeperNewAccountsClosedComponent,
  KeykeeperNewAccountsReason,
} from "./new-accounts-closed.component";

const CONTACT_PAGE = "https://passbundle.example/contact/";

/** The sentences, as the brand step's English has them. */
const ENGLISH: Record<string, string> = {
  keykeeperNewAccountsNotOpenYet: "New accounts aren't open yet.",
  keykeeperNewAccountsAskForOne: "Ask for one",
  keykeeperNewAccountsOwnServer:
    "This server isn't taking new accounts. Ask the person who runs it.",
  keykeeperNewAccountsNotThatAddress: "New accounts aren't open for that address.",
  keykeeperNewAccountsNotThatAddressOwnServer:
    "New accounts aren't open for that address. Ask the person who runs this server.",
  keykeeperContactPage: CONTACT_PAGE,
};

describe("KeykeeperNewAccountsClosedComponent", () => {
  let fixture: ComponentFixture<KeykeeperNewAccountsClosedComponent>;
  let environment$: BehaviorSubject<Environment>;
  let messages: Record<string, string>;

  const env = (region: Region) => ({ getRegion: () => region }) as unknown as Environment;
  const el = () => fixture.nativeElement as HTMLElement;
  const said = () => el().textContent?.replace(/\s+/g, " ").trim();
  const link = () => el().querySelector<HTMLAnchorElement>("a");

  async function render(region: Region, reason?: KeykeeperNewAccountsReason) {
    environment$ = new BehaviorSubject(env(region));
    await TestBed.configureTestingModule({
      imports: [KeykeeperNewAccountsClosedComponent],
      providers: [
        { provide: EnvironmentService, useValue: { globalEnvironment$: environment$ } },
        // A message the build doesn't have comes back empty, as the real service gives it.
        { provide: I18nService, useValue: { t: (key: string) => messages[key] ?? "" } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperNewAccountsClosedComponent);
    if (reason) {
      fixture.componentRef.setInput("reason", reason);
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    messages = { ...ENGLISH };
  });

  it("on the service, says new accounts aren't open yet, with a link to the website's Contact page", async () => {
    await render(Region.US);

    expect(said()).toBe("New accounts aren't open yet. Ask for one");
    expect(link()?.textContent?.trim()).toBe("Ask for one");
    expect(link()?.getAttribute("href")).toBe(CONTACT_PAGE);
    expect(link()?.getAttribute("target")).toBe("_blank");
    expect(link()?.getAttribute("rel")).toBe("noreferrer");
  });

  it("on anyone else's server, says to ask the person who runs it, with no link", async () => {
    await render(Region.SelfHosted);

    expect(said()).toBe("This server isn't taking new accounts. Ask the person who runs it.");
    expect(link()).toBeNull();
  });

  it("for a refused address on the service, says so with the same link", async () => {
    await render(Region.US, "address");

    expect(said()).toBe("New accounts aren't open for that address. Ask for one");
    expect(link()?.getAttribute("href")).toBe(CONTACT_PAGE);
  });

  it("for a refused address on anyone else's server, says who to ask, with no link", async () => {
    await render(Region.SelfHosted, "address");

    expect(said()).toBe(
      "New accounts aren't open for that address. Ask the person who runs this server.",
    );
    expect(link()).toBeNull();
  });

  it("follows the server the page talks to when it changes", async () => {
    await render(Region.US);

    environment$.next(env(Region.SelfHosted));
    fixture.detectChanges();

    expect(said()).toBe("This server isn't taking new accounts. Ask the person who runs it.");
    expect(link()).toBeNull();
  });

  it("carries the reason for whoever styles or tests it", async () => {
    await render(Region.US, "address");

    const sentence = el().querySelector('[data-testid="keykeeper-new-accounts-closed"]');
    expect(sentence?.getAttribute("data-reason")).toBe("address");
  });

  it.each([
    "",
    "keykeeperContactPage",
    "http://passbundle.example/contact/",
    "javascript:alert(1)",
  ])("shows no link when the build has no https Contact page (%p)", async (address) => {
    messages.keykeeperContactPage = address;
    await render(Region.US);

    expect(said()).toBe("New accounts aren't open yet.");
    expect(link()).toBeNull();
  });
});
