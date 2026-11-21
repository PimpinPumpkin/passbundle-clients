import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { AuthRequestServiceAbstraction } from "@bitwarden/auth/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { DevicesServiceAbstraction } from "@bitwarden/common/auth/abstractions/devices/devices.service.abstraction";
import { AuthRequestResponse } from "@bitwarden/common/auth/models/response/auth-request.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { ValidationService } from "@bitwarden/common/platform/abstractions/validation.service";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { DialogRef, DIALOG_DATA, ToastService } from "@bitwarden/components";
import { LogService } from "@bitwarden/logging";

import { KeykeeperApprovalConfirmation } from "../keykeeper/confirm-approval/confirm-approval.service";

import { LoginApprovalDialogComponent } from "./login-approval-dialog.component";

describe("LoginApprovalDialogComponent", () => {
  let component: LoginApprovalDialogComponent;
  let fixture: ComponentFixture<LoginApprovalDialogComponent>;

  let accountService: MockProxy<AccountService>;
  let apiService: MockProxy<ApiService>;
  let authRequestService: MockProxy<AuthRequestServiceAbstraction>;
  let devicesService: MockProxy<DevicesServiceAbstraction>;
  let dialogRef: MockProxy<DialogRef>;
  let i18nService: MockProxy<I18nService>;
  let logService: MockProxy<LogService>;
  let toastService: MockProxy<ToastService>;
  let validationService: MockProxy<ValidationService>;
  let confirmation: MockProxy<KeykeeperApprovalConfirmation>;

  const testNotificationId = "test-notification-id";
  const testEmail = "test@bitwarden.com";
  const testPublicKey = "test-public-key";

  beforeEach(async () => {
    accountService = mock<AccountService>();
    apiService = mock<ApiService>();
    authRequestService = mock<AuthRequestServiceAbstraction>();
    devicesService = mock<DevicesServiceAbstraction>();
    dialogRef = mock<DialogRef>();
    i18nService = mock<I18nService>();
    logService = mock<LogService>();
    toastService = mock<ToastService>();
    validationService = mock<ValidationService>();
    confirmation = mock<KeykeeperApprovalConfirmation>();
    confirmation.confirm.mockResolvedValue(true);
    confirmation.fromApproval.mockResolvedValue(false);

    accountService.activeAccount$ = of({
      id: "test-user-id" as UserId,
      ...mockAccountInfoWith({
        email: testEmail,
        name: null,
      }),
    });

    await TestBed.configureTestingModule({
      imports: [LoginApprovalDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: { notificationId: testNotificationId } },
        { provide: AccountService, useValue: accountService },
        { provide: ApiService, useValue: apiService },
        { provide: AuthRequestServiceAbstraction, useValue: authRequestService },
        { provide: DevicesServiceAbstraction, useValue: devicesService },
        { provide: DialogRef, useValue: dialogRef },
        { provide: I18nService, useValue: i18nService },
        { provide: LogService, useValue: logService },
        { provide: ToastService, useValue: toastService },
        { provide: ValidationService, useValue: validationService },
        { provide: KeykeeperApprovalConfirmation, useValue: confirmation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginApprovalDialogComponent);
    component = fixture.componentInstance;
  });

  it("creates successfully", () => {
    expect(component).toBeTruthy();
  });

  describe("ngOnInit", () => {
    beforeEach(() => {
      apiService.getAuthRequest.mockResolvedValue({
        publicKey: testPublicKey,
        creationDate: new Date().toISOString(),
      } as AuthRequestResponse);
      authRequestService.getFingerprintPhrase.mockResolvedValue("test-phrase");
    });

    it("retrieves and sets auth request data", async () => {
      await component.ngOnInit();

      expect(apiService.getAuthRequest).toHaveBeenCalledWith(testNotificationId);
      expect(component.email).toBe(testEmail);
      expect(component.fingerprintPhrase).toBeDefined();
    });

    it("updates time text initially", async () => {
      i18nService.t.mockReturnValue("justNow");

      await component.ngOnInit();
      expect(component.requestTimeText).toBe("justNow");
    });
  });

  describe("retrieveAuthRequestAndRespond", () => {
    const verifiedAuthRequestResponse = {
      id: "test-request-id",
      publicKey: testPublicKey,
      creationDate: new Date().toISOString(),
      requestApproved: undefined,
      responseDate: undefined,
    } as AuthRequestResponse;

    const refetchedAuthRequestResponse = {
      ...verifiedAuthRequestResponse,
      publicKey: "refetched-public-key",
    } as AuthRequestResponse;

    beforeEach(async () => {
      // Fetch #1 (fingerprint-verified) happens in ngOnInit.
      apiService.getAuthRequest.mockResolvedValueOnce(verifiedAuthRequestResponse);
      authRequestService.getFingerprintPhrase.mockResolvedValue("test-phrase");
      await component.ngOnInit();

      // Fetch #2 (validity check inside retrieveAuthRequestAndRespond)
      apiService.getAuthRequest.mockResolvedValueOnce(refetchedAuthRequestResponse);
    });

    it("denyLogin encapsulates using the original fingerprint-verified request, not the re-fetched one", async () => {
      authRequestService.approveOrDenyAuthRequest.mockResolvedValue(verifiedAuthRequestResponse);
      i18nService.t.mockReturnValue("denied message");

      await component.denyLogin();

      expect(authRequestService.approveOrDenyAuthRequest).toHaveBeenCalledWith(
        false,
        verifiedAuthRequestResponse,
      );
      expect(authRequestService.approveOrDenyAuthRequest).not.toHaveBeenCalledWith(
        false,
        expect.objectContaining({ publicKey: "refetched-public-key" }),
      );
      expect(toastService.showToast).toHaveBeenCalledWith({
        variant: "info",
        message: "denied message",
      });
    });

    it("approveLogin encapsulates using the original fingerprint-verified request, not the re-fetched one", async () => {
      authRequestService.approveOrDenyAuthRequest.mockResolvedValue(verifiedAuthRequestResponse);

      await component.approveLogin();

      expect(authRequestService.approveOrDenyAuthRequest).toHaveBeenCalledWith(
        true,
        verifiedAuthRequestResponse,
      );
      expect(authRequestService.approveOrDenyAuthRequest).not.toHaveBeenCalledWith(
        true,
        expect.objectContaining({ publicKey: "refetched-public-key" }),
      );
    });

    it("shows info toast and does not answer when the re-fetched request is already answered", async () => {
      apiService.getAuthRequest.mockReset();
      apiService.getAuthRequest.mockResolvedValueOnce(verifiedAuthRequestResponse);
      authRequestService.getFingerprintPhrase.mockResolvedValue("test-phrase");
      await component.ngOnInit();
      apiService.getAuthRequest.mockResolvedValueOnce({
        ...refetchedAuthRequestResponse,
        requestApproved: true,
      } as AuthRequestResponse);
      i18nService.t.mockReturnValue("no longer valid");

      await component.denyLogin();

      expect(authRequestService.approveOrDenyAuthRequest).not.toHaveBeenCalled();
      expect(toastService.showToast).toHaveBeenCalledWith({
        variant: "info",
        message: "no longer valid",
      });
    });

    it("logs an error and does not fetch or answer if authRequestResponse was never populated", async () => {
      component.authRequestResponse = undefined;
      apiService.getAuthRequest.mockReset();

      await component.denyLogin();

      expect(apiService.getAuthRequest).not.toHaveBeenCalled();
      expect(authRequestService.approveOrDenyAuthRequest).not.toHaveBeenCalled();
      expect(logService.error).toHaveBeenCalled();
    });
  });

  // Keykeeper: approving asks the person to confirm it's them first, as our
  // apps do; denying doesn't (DESIGN.md, "The web vault and the extension").
  describe("confirming before approving", () => {
    const waiting = {
      id: "test-request-id",
      publicKey: testPublicKey,
      creationDate: new Date().toISOString(),
      requestApproved: undefined,
      responseDate: undefined,
    } as AuthRequestResponse;

    beforeEach(async () => {
      apiService.getAuthRequest.mockResolvedValue(waiting);
      authRequestService.getFingerprintPhrase.mockResolvedValue("test-phrase");
      authRequestService.approveOrDenyAuthRequest.mockResolvedValue(waiting);
      await component.ngOnInit();
      apiService.getAuthRequest.mockClear();
    });

    it("approves only after the person confirms", async () => {
      confirmation.confirm.mockResolvedValue(true);

      await component.approveLogin();

      expect(confirmation.confirm).toHaveBeenCalledTimes(1);
      expect(confirmation.confirm.mock.invocationCallOrder[0]).toBeLessThan(
        authRequestService.approveOrDenyAuthRequest.mock.invocationCallOrder[0],
      );
      expect(authRequestService.approveOrDenyAuthRequest).toHaveBeenCalledWith(true, waiting);
    });

    it("sends nothing, and stays open, when the person doesn't confirm (a wrong password, or Cancel)", async () => {
      confirmation.confirm.mockResolvedValue(false);

      await component.approveLogin();

      expect(confirmation.confirm).toHaveBeenCalledTimes(1);
      expect(authRequestService.approveOrDenyAuthRequest).not.toHaveBeenCalled();
      expect(apiService.getAuthRequest).not.toHaveBeenCalled();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it("denies without asking for a confirmation", async () => {
      await component.denyLogin();

      expect(confirmation.confirm).not.toHaveBeenCalled();
      expect(authRequestService.approveOrDenyAuthRequest).toHaveBeenCalledWith(false, waiting);
    });
  });

  // Keykeeper: where the request comes from, from the server's own location
  // database, with the database's credit beside it (DESIGN.md, "New-device
  // check", "Where a sign-in comes from").
  describe("where the request comes from", () => {
    const rendered = async (fields: Record<string, unknown>) => {
      i18nService.t.mockImplementation((key: string) =>
        key === "keykeeperApproveSignInUnknownLocation" ? "Unknown location" : key,
      );
      apiService.getAuthRequest.mockResolvedValue(
        new AuthRequestResponse({
          id: "test-request-id",
          publicKey: testPublicKey,
          requestDeviceType: "Chrome",
          requestDeviceTypeValue: 9,
          requestIpAddress: "203.0.113.7",
          creationDate: new Date().toISOString(),
          requestApproved: null,
          responseDate: null,
          ...fields,
        }),
      );
      authRequestService.getFingerprintPhrase.mockResolvedValue("test-phrase");
      await component.ngOnInit();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      return {
        location: el.querySelector("[data-testid=keykeeper-login-approval-location]"),
        source: el.querySelector("[data-testid=keykeeper-login-approval-location-source]"),
        text: el.textContent!.replace(/\s+/g, " "),
      };
    };

    const dbIp = { name: "IP Geolocation by DB-IP", url: "https://db-ip.com" };

    it("shows the location and its address, with the database's credit linked beside it", async () => {
      const { location, source } = await rendered({
        location: "Fixture City, Germany",
        locationSource: dbIp,
      });

      expect(location!.textContent!.replace(/\s+/g, " ").trim()).toBe(
        "Fixture City, Germany (203.0.113.7)",
      );
      const link = source!.querySelector("a")!;
      expect(link.textContent!.trim()).toBe("IP Geolocation by DB-IP");
      expect(link.getAttribute("href")).toBe("https://db-ip.com");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    });

    it("credits a database without an address in words, and never links what isn't https", async () => {
      const { source } = await rendered({
        location: "Fixture City, Germany",
        locationSource: { name: "Our own database", url: "javascript:alert(1)" },
      });

      expect(source!.textContent!.trim()).toBe("Our own database");
      expect(source!.querySelector("a")).toBeNull();
    });

    it("says Unknown location, with no credit, for an address the database can't place", async () => {
      const { location, source } = await rendered({ location: null, locationSource: dbIp });

      expect(location!.textContent!.replace(/\s+/g, " ").trim()).toBe(
        "Unknown location (203.0.113.7)",
      );
      expect(source).toBeNull();
    });

    it("shows no location and no credit when the server has no location database", async () => {
      const { location, source, text } = await rendered({ location: null, locationSource: null });

      expect(location).toBeNull();
      expect(source).toBeNull();
      expect(text).not.toContain("Unknown location");
      // Upstream's line, as it was: the address.
      expect(text).toContain("(203.0.113.7)");
    });
  });

  // Keykeeper: a session that began from another device's approval can't
  // approve one (the server refuses it), so it's told so up front, as our apps
  // do, and offered Deny and Close, never the confirmation (DESIGN.md,
  // "Approving a sign-in from another device", "The web vault and the
  // extension").
  describe("a session from another device's approval", () => {
    const waiting = new AuthRequestResponse({
      id: "test-request-id",
      publicKey: testPublicKey,
      requestDeviceType: "Chrome",
      requestDeviceTypeValue: 9,
      requestIpAddress: "203.0.113.7",
      creationDate: new Date().toISOString(),
      requestApproved: null,
      responseDate: null,
    });

    const opened = async (fromApproval: boolean) => {
      i18nService.t.mockImplementation((key: string) => key);
      confirmation.fromApproval.mockResolvedValue(fromApproval);
      apiService.getAuthRequest.mockResolvedValue(waiting);
      authRequestService.getFingerprintPhrase.mockResolvedValue("test-phrase");
      authRequestService.approveOrDenyAuthRequest.mockResolvedValue(waiting);
      // As the dialog service opens it: closable.
      dialogRef.disableClose = false;
      await component.ngOnInit();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const buttons = () =>
        Array.from(el.querySelectorAll("button[bitButton]")) as HTMLButtonElement[];
      return {
        note: el.querySelector("[data-testid=keykeeper-login-approval-from-approval]"),
        button: (label: string) => buttons().find((b) => b.textContent!.trim() === label),
        labels: () => buttons().map((b) => b.textContent!.trim()),
        text: el.textContent!.replace(/\s+/g, " "),
      };
    };

    it("says up front that it can't approve here, in our apps' words, with no Confirm access", async () => {
      const { note, labels, text } = await opened(true);

      expect(note).not.toBeNull();
      expect(note!.textContent).toContain("keykeeperApprovalSessionCantApprove");
      expect(labels()).not.toContain("confirmAccess");
      // The request itself still shows, so the person can tell what to deny.
      expect(text).toContain("test-phrase");
      expect(text).toContain("(203.0.113.7)");
    });

    it("offers Deny, which denies without a confirmation, and Close, which answers nothing", async () => {
      const shown = await opened(true);
      expect(shown.labels()).toEqual(["denyAccess", "close"]);

      shown.button("close")!.click();
      // Closed with no answer: the extension and Settings, Devices count only
      // true or false as one, so the request stays waiting.
      expect(dialogRef.close).toHaveBeenCalledTimes(1);
      expect(typeof dialogRef.close.mock.calls[0][0]).not.toBe("boolean");
      expect(authRequestService.approveOrDenyAuthRequest).not.toHaveBeenCalled();

      await component.denyLogin();
      expect(confirmation.confirm).not.toHaveBeenCalled();
      expect(authRequestService.approveOrDenyAuthRequest).toHaveBeenCalledTimes(1);
      expect(authRequestService.approveOrDenyAuthRequest).toHaveBeenCalledWith(false, waiting);
    });

    it("never asks for the confirmation or sends an approval", async () => {
      await opened(true);
      apiService.getAuthRequest.mockClear();

      await component.approveLogin();

      expect(confirmation.confirm).not.toHaveBeenCalled();
      expect(authRequestService.approveOrDenyAuthRequest).not.toHaveBeenCalled();
      expect(apiService.getAuthRequest).not.toHaveBeenCalled();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it("is read as the dialog opens: a master password or single sign-on session sees Confirm access and no note", async () => {
      const { note, labels } = await opened(false);

      expect(confirmation.fromApproval).toHaveBeenCalledTimes(1);
      expect(note).toBeNull();
      expect(labels()).toEqual(["confirmAccess", "denyAccess"]);
    });
  });
});
