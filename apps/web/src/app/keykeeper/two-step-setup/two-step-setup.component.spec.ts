import { NgZone } from "@angular/core";
import { Router } from "@angular/router";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { KEYKEEPER_TWO_STEP_SETUP } from "@bitwarden/auth/angular";
import { PasswordPreloginService } from "@bitwarden/common/auth/password-prelogin";
import {
  Environment,
  EnvironmentService,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { PLAIN_ERRORS } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { ToastService } from "@bitwarden/components";

import { KeykeeperTwoStepSetupComponent } from "./two-step-setup.component";

const API = "https://vault.example.test/api";

const info = {
  email: "ana@example.test",
  requiredBy: ["Acme Dental"],
  hasMasterPassword: true,
  methods: { authenticator: true, webauthn: false, duo: false },
};

/** A server's answer, as fetch gives it. */
const answer = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

/** A refusal as Vaultwarden sends it. */
const refusal = (message: string) => ({
  message,
  validationErrors: { "": [message] },
  ErrorModel: { Message: message, Object: "error" },
  object: "error",
});

describe("Set up two-step login to continue", () => {
  let fetch: jest.Mock;
  let toastService: ReturnType<typeof mock<ToastService>>;

  function setUp() {
    toastService = mock<ToastService>();
    const environmentService = mock<EnvironmentService>();
    environmentService.environment$ = of({
      getApiUrl: () => API,
      getWebVaultUrl: () => "https://vault.example.test",
    } as unknown as Environment);
    return new KeykeeperTwoStepSetupComponent(
      mock<Router>(),
      environmentService,
      mock<PasswordPreloginService>(),
      // The master password's hash is handed over in these tests; nothing derives one.
      {} as never,
      mock<PlatformUtilsService>(),
      toastService,
      { runOutsideAngular: (fn: () => void) => fn() } as unknown as NgZone,
    );
  }

  /** Answers the page's requests by method and path, in order. */
  function server(...answers: [string, () => Promise<Response>][]) {
    fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const index = answers.findIndex(([route]) => route === `${init.method} ${url}`);
      if (index < 0) {
        throw new Error(`unexpected ${init.method} ${url}`);
      }
      const [[, reply]] = answers.splice(index, 1);
      return reply();
    });
  }

  beforeEach(() => {
    sessionStorage.setItem(
      KEYKEEPER_TWO_STEP_SETUP,
      JSON.stringify({ token: "setup-token", requiredBy: ["Acme Dental"] }),
    );
    fetch = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = fetch;
    // The authenticator's QR code library, as the web vault serves it.
    (window as unknown as { QRious?: unknown }).QRious = class {};
  });

  afterEach(() => {
    sessionStorage.clear();
    delete (globalThis as { fetch?: unknown }).fetch;
    delete (window as unknown as { QRious?: unknown }).QRious;
  });

  /** On the authenticator step, with the key read and the master password's hash taken. */
  async function onTheAuthenticatorStep(page: KeykeeperTwoStepSetupComponent) {
    await page.ngOnInit();
    page["held"].masterPasswordHash = "server-hash";
    page["masterPassword"].setValue("");
    await page["startAuthenticator"]();
    expect(page["step"]()).toBe("authenticator");
    page["authenticatorForm"].controls.code.setValue("123 456");
  }

  it("says a wrong code is wrong in plain words, never with the server's time or the address", async () => {
    server(
      [`GET ${API}/keykeeper/two-step-setup`, async () => answer(200, info)],
      [`POST ${API}/two-factor/get-authenticator`, async () => answer(200, { key: "KEY" })],
      [
        `PUT ${API}/two-factor/authenticator`,
        async () =>
          answer(
            400,
            refusal("Invalid TOTP code! Server time: 2026-11-07 15:04:05 UTC IP: 203.0.113.9"),
          ),
      ],
    );
    const page = setUp();
    await onTheAuthenticatorStep(page);

    await page["turnOnAuthenticator"]();

    const [{ message }] = toastService.showToast.mock.calls.at(-1)!;
    expect(message).toBe(
      "That code didn't work. Enter the newest code your authenticator app shows. If it still doesn't work, check that this device's clock sets itself automatically.",
    );
    expect(message).not.toMatch(/203\.0\.113|Server time|UTC/);
    expect(page["step"]()).toBe("authenticator");
  });

  it("says the server had a problem, not nothing, when a proxy answers with a page", async () => {
    server(
      [`GET ${API}/keykeeper/two-step-setup`, async () => answer(200, info)],
      [`POST ${API}/two-factor/get-authenticator`, async () => answer(200, { key: "KEY" })],
      [`PUT ${API}/two-factor/authenticator`, async () => answer(502, null)],
    );
    const page = setUp();
    await onTheAuthenticatorStep(page);

    await page["turnOnAuthenticator"]();

    expect(toastService.showToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: PLAIN_ERRORS.serverProblem,
    });
  });

  it("says when the server can't be reached, rather than 'Failed to fetch'", async () => {
    server(
      [`GET ${API}/keykeeper/two-step-setup`, async () => answer(200, info)],
      [
        `POST ${API}/two-factor/get-authenticator`,
        () => Promise.reject(new TypeError("Failed to fetch")),
      ],
    );
    const page = setUp();
    await page.ngOnInit();
    page["held"].masterPasswordHash = "server-hash";

    await page["startAuthenticator"]();

    expect(toastService.showToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: PLAIN_ERRORS.offline,
    });
    expect(page["step"]()).toBe("choose");
  });

  it("offers to try again when the page couldn't load, and keeps the master password's hash", async () => {
    server(
      [
        `GET ${API}/keykeeper/two-step-setup`,
        () => Promise.reject(new TypeError("Failed to fetch")),
      ],
      [`GET ${API}/keykeeper/two-step-setup`, async () => answer(200, info)],
    );
    const page = setUp();
    page["held"].masterPasswordHash = "server-hash";

    await page.ngOnInit();
    expect(page["step"]()).toBe("problem");
    expect(page["problem"]()).toBe(PLAIN_ERRORS.offline);
    expect(page["canRetry"]()).toBe(true);

    await page["retry"]();
    expect(page["step"]()).toBe("choose");
    expect(page["haveHash"]()).toBe(true);
  });

  it("says to sign in again, and offers nothing else, when the setup session ended", async () => {
    server([`GET ${API}/keykeeper/two-step-setup`, async () => answer(401, null)]);
    const page = setUp();

    await page.ngOnInit();

    expect(page["step"]()).toBe("problem");
    expect(page["problem"]()).toBe("This setup session expired. Sign in again.");
    expect(page["canRetry"]()).toBe(false);
  });
});
