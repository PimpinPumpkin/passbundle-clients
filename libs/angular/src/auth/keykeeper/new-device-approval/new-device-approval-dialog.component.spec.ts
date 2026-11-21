import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import {
  KeykeeperLocationSource,
  KeykeeperNewDeviceRequest,
} from "@bitwarden/common/auth/keykeeper/new-device-check";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DIALOG_DATA, DialogRef, ToastService } from "@bitwarden/components";

import { KeykeeperNewDeviceApprovalDialogComponent } from "./new-device-approval-dialog.component";

/**
 * Where a new device's sign-in comes from (DESIGN.md, "New-device check",
 * "Where a sign-in comes from"): the place and its address, with the location
 * database's credit; "Unknown location" for an address the database can't
 * place; and, from a server without a location database, the address alone,
 * with no location line at all.
 */
describe("KeykeeperNewDeviceApprovalDialogComponent, where it comes from", () => {
  const dbIp: KeykeeperLocationSource = {
    name: "IP Geolocation by DB-IP",
    url: "https://db-ip.com",
  };

  const request = (
    location: string | null,
    ipAddress = "203.0.113.7",
  ): KeykeeperNewDeviceRequest => ({
    id: "check-1",
    device: "Web vault in Firefox",
    ipAddress,
    location,
    creationDate: new Date().toISOString(),
    expirationDate: new Date(Date.now() + 600_000).toISOString(),
    emailAfter: null,
  });

  async function rendered(r: KeykeeperNewDeviceRequest, source: KeykeeperLocationSource | null) {
    const i18nService = mock<I18nService>();
    i18nService.t.mockImplementation((key: string) =>
      key === "keykeeperApproveSignInUnknownLocation" ? "Unknown location" : key,
    );
    await TestBed.configureTestingModule({
      imports: [KeykeeperNewDeviceApprovalDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: { request: r, email: "ana@example.test", source } },
        { provide: DialogRef, useValue: mock<DialogRef>() },
        { provide: ApiService, useValue: mock<ApiService>() },
        { provide: I18nService, useValue: i18nService },
        { provide: ToastService, useValue: mock<ToastService>() },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KeykeeperNewDeviceApprovalDialogComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const text = (id: string) =>
      el.querySelector(`[data-testid=${id}]`)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    return {
      where: text("keykeeper-new-device-approval-where"),
      address: text("keykeeper-new-device-approval-address"),
      credit: el.querySelector("a[href='https://db-ip.com']")?.textContent?.trim() ?? null,
      all: el.textContent!.replace(/\s+/g, " "),
    };
  }

  it("shows the place and its address, with the database's credit", async () => {
    const shown = await rendered(request("Fixture City, Germany"), dbIp);

    expect(shown.where).toBe("Fixture City, Germany (203.0.113.7)");
    expect(shown.address).toBeNull();
    expect(shown.credit).toBe("IP Geolocation by DB-IP");
  });

  it("says Unknown location, with no credit, for an address the database can't place", async () => {
    const shown = await rendered(request(null, "10.1.2.3"), dbIp);

    expect(shown.where).toBe("Unknown location (10.1.2.3)");
    expect(shown.address).toBeNull();
    expect(shown.credit).toBeNull();
  });

  it("shows the address alone, and no location line, when the server has no location database", async () => {
    const shown = await rendered(request(null), null);

    expect(shown.where).toBeNull();
    expect(shown.address).toBe("203.0.113.7");
    expect(shown.all).not.toContain("Unknown location");
    expect(shown.all).not.toContain("keykeeperApproveSignInWhere");
    expect(shown.credit).toBeNull();
  });
});
