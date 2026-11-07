import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AvailableRegionsService } from "@bitwarden/common/platform/abstractions/available-regions.service";
import {
  Environment,
  EnvironmentService,
  Region,
  RegionConfig,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService } from "@bitwarden/components";

import { KEYKEEPER_SERVER_CHECK_FETCH } from "./server-check";
import { KeykeeperVaultLocationComponent } from "./vault-location.component";

/** A server's settings, as every server the extension can sign in to answers. */
const SERVER_SETTINGS = { version: "2026.6.0", object: "config" };

function answer(status: number, body: unknown, type = "application/json") {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? type : null) },
    json: async () => body,
  } as unknown as Response;
}

describe("KeykeeperVaultLocationComponent", () => {
  let fixture: ComponentFixture<KeykeeperVaultLocationComponent>;
  let environment$: BehaviorSubject<Environment>;
  let environmentService: {
    globalEnvironment$: BehaviorSubject<Environment>;
    setEnvironment: jest.Mock;
  };
  let isDev: boolean;
  /** The check's requests, answered as a server there would (`answers`, by URL). */
  let serverFetch: jest.Mock;
  let answers: Record<string, () => Promise<Response>>;

  const cloud = { key: Region.US, domain: "passbundle.com" } as RegionConfig;

  const env = (region: Region, base = "", custom: Record<string, string> = {}) =>
    ({ getRegion: () => region, getUrls: () => ({ base, ...custom }) }) as unknown as Environment;
  let dialogService: { open: jest.Mock };

  const el = () => fixture.nativeElement as HTMLElement;
  const segments = () => [...el().querySelectorAll<HTMLButtonElement>('[data-part="segment"]')];
  const address = () => el().querySelector<HTMLInputElement>("#keykeeper-server-address");

  async function render() {
    fixture = TestBed.createComponent(KeykeeperVaultLocationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Types without leaving the field. */
  async function typeOnly(value: string) {
    const input = address()!;
    input.value = value;
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const component = () => fixture.componentInstance;
  const shownError = () => el().querySelector('[role="alert"]')?.textContent?.trim();

  async function type(value: string) {
    const input = address()!;
    input.value = value;
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    isDev = false;
    environment$ = new BehaviorSubject(env(Region.US));
    environmentService = {
      globalEnvironment$: environment$,
      setEnvironment: jest.fn(async (region: Region, urls?: { base?: string }) => {
        environment$.next(env(region, urls?.base ?? ""));
        return {};
      }),
    };

    dialogService = { open: jest.fn(() => ({ closed: of(false) })) };
    answers = {};
    serverFetch = jest.fn(async (url: string) =>
      answers[url] ? answers[url]() : answer(200, SERVER_SETTINGS),
    );

    await TestBed.configureTestingModule({
      imports: [KeykeeperVaultLocationComponent],
      providers: [
        { provide: EnvironmentService, useValue: environmentService },
        {
          provide: AvailableRegionsService,
          useValue: { availableRegions$: new BehaviorSubject([cloud]) },
        },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: PlatformUtilsService, useValue: { isDev: () => isDev } },
        { provide: DialogService, useValue: dialogService },
        { provide: KEYKEEPER_SERVER_CHECK_FETCH, useValue: serverFetch },
      ],
    }).compileComponents();
  });

  it("offers the service and the person's own server, with the service picked", async () => {
    await render();

    expect(segments().map((s) => s.textContent?.trim())).toEqual([
      "appName",
      "keykeeperMyOwnServer",
    ]);
    expect(segments().map((s) => s.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(address()).toBeNull();
  });

  it("asks for the server's address when it's their own, and saves it with https:// added", async () => {
    await render();

    segments()[1].click();
    fixture.detectChanges();
    expect(address()).not.toBeNull();
    expect(el().textContent).toContain("keykeeperServerAddressHint");

    await type(" test.passbundle.com ");

    expect(environmentService.setEnvironment).toHaveBeenCalledWith(Region.SelfHosted, {
      base: "https://test.passbundle.com",
    });
  });

  it("saves an address the way the self-hosted dialog does", async () => {
    await render();
    segments()[1].click();
    fixture.detectChanges();

    await type("vault.example.com:8443/");
    expect(environmentService.setEnvironment).toHaveBeenLastCalledWith(Region.SelfHosted, {
      base: "https://vault.example.com:8443/",
    });

    await type("HTTPS://vault.example.com");
    expect(environmentService.setEnvironment).toHaveBeenLastCalledWith(Region.SelfHosted, {
      base: "https://vault.example.com",
    });
  });

  it("takes an http:// address in a development build, as the dialog does", async () => {
    isDev = true;
    await render();
    segments()[1].click();
    fixture.detectChanges();

    await type("http://localhost:8000");

    expect(environmentService.setEnvironment).toHaveBeenCalledWith(Region.SelfHosted, {
      base: "http://localhost:8000",
    });
  });

  it("refuses an address that isn't https://, as the self-hosted dialog does", async () => {
    await render();
    segments()[1].click();
    fixture.detectChanges();

    await type("http://vault.example.com");

    expect(environmentService.setEnvironment).not.toHaveBeenCalled();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      "selfHostedEnvMustUseHttps",
    );
  });

  it("shows the saved server, without its https://", async () => {
    environment$.next(env(Region.SelfHosted, "https://127.0.0.1:8443"));
    await render();

    expect(segments().map((s) => s.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(address()!.value).toBe("127.0.0.1:8443");
  });

  it("goes back to the service when it's picked", async () => {
    environment$.next(env(Region.SelfHosted, "https://vault.example.com"));
    await render();

    segments()[0].click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(environmentService.setEnvironment).toHaveBeenCalledWith(Region.US);
    expect(address()).toBeNull();
  });

  // Signing in never goes to a server other than the one shown.
  describe("before signing in goes on", () => {
    it("blocks it while My own server is blank, and says why when it's tried", async () => {
      await render();
      segments()[1].click();
      fixture.detectChanges();

      expect(component().blocksSignIn()).toBe(true);
      expect(await component().commit()).toBe(false);
      fixture.detectChanges();
      expect(shownError()).toBe("keykeeperServerAddressNeeded");
      expect(environmentService.setEnvironment).not.toHaveBeenCalled();
    });

    it("blocks it for an address the self-hosted dialog refuses, and keeps the saved server", async () => {
      environment$.next(env(Region.SelfHosted, "https://a.example"));
      await render();

      await type("http://b.example");
      expect(shownError()).toBe("selfHostedEnvMustUseHttps");
      expect(component().blocksSignIn()).toBe(true);
      expect(await component().commit()).toBe(false);

      await type("passbundle.com@evil.example");
      expect(shownError()).toBe("keykeeperServerAddressOnly");
      expect(component().blocksSignIn()).toBe(true);

      await type("vault.example.com/?next=evil");
      expect(shownError()).toBe("keykeeperServerAddressOnly");

      expect(environmentService.setEnvironment).not.toHaveBeenCalled();
    });

    it("saves a typed address that wasn't saved yet, and then lets it go on", async () => {
      await render();
      segments()[1].click();
      fixture.detectChanges();

      await typeOnly("b.example");
      expect(component().blocksSignIn()).toBe(false);
      expect(environmentService.setEnvironment).not.toHaveBeenCalled();

      expect(await component().commit()).toBe(true);
      expect(environmentService.setEnvironment).toHaveBeenCalledWith(Region.SelfHosted, {
        base: "https://b.example",
      });
    });

    it("asks the server first, and saves the address once one answers there", async () => {
      await render();
      segments()[1].click();
      fixture.detectChanges();

      await type("vault.example.com");

      expect(serverFetch).toHaveBeenCalledWith(
        "https://vault.example.com/api/config",
        expect.objectContaining({ method: "GET", credentials: "omit" }),
      );
      expect(environmentService.setEnvironment).toHaveBeenCalledWith(Region.SelfHosted, {
        base: "https://vault.example.com",
      });
      expect(shownError()).toBeUndefined();
    });

    it.each([
      [
        "nothing answers",
        () => Promise.reject(new TypeError("Failed to fetch")),
        "keykeeperServerUnreachable",
      ],
      [
        "it's a website",
        async () => answer(200, "<html></html>", "text/html"),
        "keykeeperServerNotAServer",
      ],
      [
        "it has no settings",
        async () => answer(404, { message: "Not found" }),
        "keykeeperServerNotAServer",
      ],
      ["it had a problem", async () => answer(502, null, "text/html"), "keykeeperServerBroken"],
      [
        "it doesn't answer in time",
        () => Promise.reject(new DOMException("The operation was aborted.", "AbortError")),
        "keykeeperServerSlow",
      ],
    ])("says what's wrong under the field, and saves nothing, when %s", async (_, reply, why) => {
      answers["https://vualt.example.com/api/config"] = reply;
      await render();
      segments()[1].click();
      fixture.detectChanges();

      await type("vualt.example.com");
      fixture.detectChanges();

      expect(shownError()).toBe(why);
      expect(address()!.getAttribute("aria-invalid")).toBe("true");
      expect(environmentService.setEnvironment).not.toHaveBeenCalled();
      expect(await component().commit()).toBe(false);
      expect(environmentService.setEnvironment).not.toHaveBeenCalled();
    });

    it("names the product when it isn't a server", async () => {
      answers["https://www.example.com/api/config"] = async () =>
        answer(200, "<html></html>", "text/html");
      const t = jest.fn((key: string, ...args: string[]) =>
        key === "appName" ? "PassBundle" : [key, ...args].join(" "),
      );
      TestBed.overrideProvider(I18nService, { useValue: { t } });
      await render();
      segments()[1].click();
      fixture.detectChanges();

      await type("www.example.com");
      fixture.detectChanges();

      expect(shownError()).toBe("keykeeperServerNotAServer PassBundle");
    });

    it("says it's checking meanwhile, and asks once for leaving the field and Continue", async () => {
      let reply!: (r: Response) => void;
      answers["https://vault.example.com/api/config"] = () =>
        new Promise<Response>((resolve) => (reply = resolve));
      await render();
      segments()[1].click();
      fixture.detectChanges();

      await typeOnly("vault.example.com");
      const input = address()!;
      input.dispatchEvent(new Event("change"));
      const continued = component().commit();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();

      expect(el().querySelector("#keykeeper-server-hint")?.textContent?.trim()).toBe(
        "keykeeperServerChecking",
      );
      reply(answer(200, SERVER_SETTINGS));
      expect(await continued).toBe(true);
      expect(serverFetch).toHaveBeenCalledTimes(1);
      expect(environmentService.setEnvironment).toHaveBeenCalledTimes(1);
    });

    it("saves nothing when the address changed while it was being checked", async () => {
      let reply!: (r: Response) => void;
      answers["https://a.example/api/config"] = () =>
        new Promise<Response>((resolve) => (reply = resolve));
      await render();
      segments()[1].click();
      fixture.detectChanges();

      await typeOnly("a.example");
      const continued = component().commit();
      await typeOnly("b.example");
      reply(answer(200, SERVER_SETTINGS));

      expect(await continued).toBe(false);
      expect(environmentService.setEnvironment).not.toHaveBeenCalled();
    });

    it("doesn't ask again for the address that's already saved", async () => {
      environment$.next(env(Region.SelfHosted, "https://a.example"));
      await render();

      expect(await component().commit()).toBe(true);
      expect(serverFetch).not.toHaveBeenCalled();
    });

    it("lets the service go on as it is", async () => {
      await render();

      expect(component().blocksSignIn()).toBe(false);
      expect(await component().commit()).toBe(true);
      expect(environmentService.setEnvironment).not.toHaveBeenCalled();
    });
  });

  describe("follows the saved environment", () => {
    it("whenever it changes, dropping what was typed and not saved", async () => {
      environment$.next(env(Region.SelfHosted, "https://a.example"));
      await render();
      await typeOnly("b.example");

      environment$.next(env(Region.SelfHosted, "https://a.example"));
      fixture.detectChanges();
      expect(address()!.value).toBe("a.example");

      environment$.next(env(Region.US));
      fixture.detectChanges();
      expect(segments().map((s) => s.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
      expect(address()).toBeNull();
    });

    it("shows only what's saved when My own server is picked again", async () => {
      await render();
      segments()[1].click();
      fixture.detectChanges();
      await typeOnly("b.example");

      segments()[0].click();
      await fixture.whenStable();
      fixture.detectChanges();
      segments()[1].click();
      fixture.detectChanges();

      expect(address()!.value).toBe("");
      expect(component().blocksSignIn()).toBe(true);
    });

    it("shows a saved address as the URL parser reads it", async () => {
      environment$.next(env(Region.SelfHosted, "https://bücher.example/vault/"));
      await render();

      expect(address()!.value).toBe("xn--bcher-kva.example/vault");
    });

    it("says when the environment has custom addresses, and opens the dialog for them", async () => {
      environment$.next(
        env(Region.SelfHosted, "", { api: "https://api.example", identity: "https://id.example" }),
      );
      await render();

      expect(address()).toBeNull();
      expect(
        el().querySelector('[data-testid="keykeeper-custom-addresses"]')?.textContent,
      ).toContain("keykeeperCustomServerAddresses");
      expect(component().blocksSignIn()).toBe(false);
      expect(await component().commit()).toBe(true);

      el()
        .querySelector<HTMLButtonElement>('[data-testid="keykeeper-custom-addresses"] button')!
        .click();
      expect(dialogService.open).toHaveBeenCalled();
    });
  });

  describe("the cursor", () => {
    it("goes into the address field when My own server is picked", async () => {
      await render();
      segments()[1].focus();
      segments()[1].click();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.activeElement).toBe(address());
    });

    it("stays where it moved meanwhile, so what's typed there stays there", async () => {
      await render();
      const elsewhere = document.createElement("input");
      document.body.append(elsewhere);
      segments()[1].focus();
      segments()[1].click();
      fixture.detectChanges();
      elsewhere.focus();
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });
  });
});
