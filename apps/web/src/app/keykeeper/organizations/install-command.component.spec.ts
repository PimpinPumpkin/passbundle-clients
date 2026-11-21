import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";

import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { ToastService } from "@bitwarden/components";

import { KeykeeperInstallCommandComponent, ShownInstallParts } from "./install-command.component";

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";
const parts: ShownInstallParts = {
  secret: "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
  fingerprint: "gpfywOP9ms6QtlYF65DLr2GSIBBe-lYsna8wlVbDQYE",
  phrase: ["alpha", "bravo"],
};

/**
 * The words people read: ours from brand/messages.en.json (a key that isn't
 * there fails), the script names brand.json gives at build time, and
 * upstream's as their keys.
 */
const keykeeperI18n = {
  t: (key: string, ...values: string[]) => {
    const built: Record<string, string> = {
      keykeeperInstallScript: "Install-PassBundle.ps1",
      keykeeperInstallScriptMacLinux: "install-passbundle.sh",
      keykeeperMacProfile: "PassBundle.mobileconfig",
    };
    if (key in built) {
      return built[key];
    }
    return key.startsWith("keykeeper") ? translate(key, ...values) : key;
  },
  translationLocale: "en-US",
};

describe("KeykeeperInstallCommandComponent, what a phone's MDM sets", () => {
  let fixture: ComponentFixture<KeykeeperInstallCommandComponent>;
  let platformUtils: MockProxy<PlatformUtilsService>;
  let toast: MockProxy<ToastService>;

  afterEach(() => TestBed.resetTestingModule());

  async function render(shown: ShownInstallParts | null, prefix = "msp-install") {
    platformUtils = mock<PlatformUtilsService>();
    toast = mock<ToastService>();
    await TestBed.configureTestingModule({
      imports: [KeykeeperInstallCommandComponent],
      providers: [
        { provide: I18nService, useValue: keykeeperI18n },
        { provide: PlatformUtilsService, useValue: platformUtils },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperInstallCommandComponent);
    fixture.componentRef.setInput("token", TOKEN);
    fixture.componentRef.setInput("parts", shown);
    fixture.componentRef.setInput("serverUrl", "https://vault.example.test/");
    fixture.componentRef.setInput("whose", "Acme Dental's");
    fixture.componentRef.setInput("joins", "Acme Dental");
    fixture.componentRef.setInput("testIdPrefix", prefix);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const page = () => fixture.nativeElement as HTMLElement;
  const phones = (prefix = "msp-install") =>
    page().querySelector<HTMLElement>(`[data-testid="${prefix}-phones"]`);
  /** Each setting the block shows: the key, its value, and its button. */
  const settings = (prefix = "msp-install") =>
    Array.from(page().querySelectorAll<HTMLElement>(`[data-testid="${prefix}-phone-setting"]`)).map(
      (row) => ({
        key: row.getAttribute("data-key"),
        shownKey: row.querySelector("code")?.textContent?.trim(),
        value: row.querySelector(`[data-testid="${prefix}-phone-value"]`)?.textContent?.trim(),
        button: row.querySelector("button")!,
      }),
    );

  it("shows the command's server and this organization's key fingerprint, under the keys the phone apps read", async () => {
    await render(parts);

    expect(settings().map(({ key, shownKey, value }) => ({ key, shownKey, value }))).toEqual([
      { key: "server_url", shownKey: "server_url", value: "https://vault.example.test" },
      { key: "org_key_fingerprint", shownKey: "org_key_fingerprint", value: parts.fingerprint },
    ]);
    // The same values the Windows command carries.
    const command = page().querySelector('[data-testid="msp-install-command"]')!.textContent!;
    expect(command).toContain("-ServerUrl 'https://vault.example.test'");
    expect(command).toContain(`-OrgKey '${parts.fingerprint}'`);
    // One plain line on where they go.
    expect(phones()!.textContent!.replace(/\s+/g, " ")).toContain(
      "For phones, set these in your MDM: in the app's managed configuration on Android, and in its managed app configuration on iPhone.",
    );
  });

  it("shows them whichever computers the command is for", async () => {
    await render(parts);

    for (const [platform, shown] of [
      ["Mac", "macos"],
      ["Linux", "linux"],
      ["Windows", "windows"],
    ]) {
      const choice = Array.from(page().querySelectorAll<HTMLElement>("bit-toggle")).find(
        (t) => t.textContent?.trim() === platform,
      )!;
      choice.querySelector<HTMLInputElement>("input")!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(
        page().querySelector('[data-testid="msp-install-command"]')!.getAttribute("data-platform"),
      ).toBe(shown);
      expect(settings().map((s) => s.value)).toEqual([
        "https://vault.example.test",
        parts.fingerprint,
      ]);
    }
  });

  it("copies each value with its own button, and says which", async () => {
    await render(parts);

    const [server, fingerprint] = settings();
    expect(server.button.textContent?.trim()).toBe("Copy");
    expect(server.button.getAttribute("aria-label")).toBe("Copy the value for server_url");
    expect(fingerprint.button.getAttribute("aria-label")).toBe(
      "Copy the value for org_key_fingerprint",
    );

    fingerprint.button.click();
    expect(platformUtils.copyToClipboard).toHaveBeenCalledWith(parts.fingerprint);
    expect(toast.showToast).toHaveBeenLastCalledWith({
      variant: "success",
      message: "Copied the value for org_key_fingerprint",
    });
    server.button.click();
    expect(platformUtils.copyToClipboard).toHaveBeenLastCalledWith("https://vault.example.test");
  });

  it("goes with the command on a company's own Joining and security page too", async () => {
    await render(parts, "org-install");

    expect(phones("org-install")).not.toBeNull();
    expect(settings("org-install").map((s) => s.value)).toEqual([
      "https://vault.example.test",
      parts.fingerprint,
    ]);
  });

  it("shows nothing for phones once the command has no key fingerprint, or one that isn't one", async () => {
    await render(parts);
    expect(phones()).not.toBeNull();

    // A command made before join secrets, which only an MSP admin can update.
    fixture.componentRef.setInput("parts", null);
    fixture.detectChanges();
    expect(phones()).toBeNull();
    expect(page().textContent).not.toContain("org_key_fingerprint");

    fixture.componentRef.setInput("parts", { ...parts, fingerprint: "not-a-fingerprint" });
    fixture.detectChanges();
    expect(phones()).toBeNull();
    expect(page().textContent).not.toContain("not-a-fingerprint");
  });
});
