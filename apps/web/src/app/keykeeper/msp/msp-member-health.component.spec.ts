import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";

import { MspClient, OrganizationUserApiService } from "@bitwarden/admin-console/common";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";

import { MspMemberHealthClient } from "./msp-member-health";
import { KeykeeperMspMemberHealthComponent } from "./msp-member-health.component";

const CONTOSO = {
  id: "contoso",
  name: "Contoso",
  createdAt: "2026-11-01T00:00:00.000Z",
  preset: "business",
  members: { confirmed: 3, accepted: 0, invited: 0, revoked: 0 },
  you: { memberId: "you", status: 2, type: 1 },
} as MspClient;

const numbers = (
  memberId: string,
  reported: { logins: number; weak: number; reused: number; exposed: number | null } | null,
) => ({
  memberId,
  logins: reported?.logins ?? null,
  weak: reported?.weak ?? null,
  reused: reported?.reused ?? null,
  exposed: reported?.exposed ?? null,
  exposedCheckedAt: null,
  reportedAt: reported ? "2026-11-07T10:00:00.000Z" : null,
});

describe("KeykeeperMspMemberHealthComponent", () => {
  let fixture: ComponentFixture<KeykeeperMspMemberHealthComponent>;
  let users: MockProxy<OrganizationUserApiService>;

  async function render(view: MspMemberHealthClient, canTurnOn: boolean) {
    users = mock<OrganizationUserApiService>();
    users.getAllMiniUserDetails.mockResolvedValue({
      data: [
        { id: "m-ana", name: "Ana", email: "ana@contoso.test" },
        { id: "m-ben", name: "", email: "ben@contoso.test" },
        { id: "m-cy", name: "Cy", email: "cy@contoso.test" },
      ],
    } as any);
    await TestBed.configureTestingModule({
      imports: [KeykeeperMspMemberHealthComponent],
      providers: [
        provideRouter([]),
        { provide: OrganizationUserApiService, useValue: users },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperMspMemberHealthComponent);
    fixture.componentRef.setInput("client", CONTOSO);
    fixture.componentRef.setInput("view", view);
    fixture.componentRef.setInput("canTurnOn", canTurnOn);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, " ");
  /** Each row's cells, as text. */
  const rows = () =>
    fixture.debugElement
      .queryAll(By.css('[data-testid="msp-own-health-row"]'))
      .map((row) =>
        Array.from((row.nativeElement as HTMLElement).querySelectorAll("td")).map((cell) =>
          cell.textContent!.replace(/\s+/g, " ").trim(),
        ),
      );

  it("names each of the client's members with their numbers, from its member list", async () => {
    await render(
      {
        organizationId: "contoso",
        on: true,
        members: [
          numbers("m-ana", { logins: 4, weak: 1, reused: 2, exposed: 1 }),
          numbers("m-ben", { logins: 3, weak: 0, reused: 0, exposed: null }),
          numbers("m-cy", null),
        ],
      },
      false,
    );
    expect(users.getAllMiniUserDetails).toHaveBeenCalledWith("contoso");
    const reportedOn = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date("2026-11-07T10:00:00.000Z"),
    );
    expect(rows()).toEqual([
      ["Ana ana@contoso.test", "4", "1", "2", "1", reportedOn],
      ["ben@contoso.test", "3", "0", "0", "Not checked", reportedOn],
      ["Cy cy@contoso.test", "Not reported yet", ""],
    ]);
    expect(text()).toContain(
      "2 of 3 members reported. In their own items: 1 weak and 2 reused passwords.",
    );
    expect(text()).toContain("Your MSP's own people aren't counted.");
    expect(text()).toContain("Neither you nor the server sees which logins");
  });

  it("says when the client has it off, with where to turn it on for an MSP admin", async () => {
    await render({ organizationId: "contoso", on: false, members: [] }, true);
    expect(users.getAllMiniUserDetails).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    expect(text()).toContain(
      "Members' own passwords is off for Contoso, so nobody's numbers are shown.",
    );
    const link = fixture.debugElement.query(By.css("a"));
    expect(link.nativeElement.getAttribute("href")).toBe("/organizations/contoso/settings/joining");
  });

  it("tells a technician who can turn it on, without a link they couldn't use", async () => {
    await render({ organizationId: "contoso", on: false, members: [] }, false);
    expect(text()).toContain("An MSP admin, or Contoso's own owners and admins, can turn it on.");
    expect(fixture.debugElement.query(By.css("a"))).toBeNull();
  });

  it("says so when the client's member list can't be read, and shows no numbers", async () => {
    users = mock<OrganizationUserApiService>();
    await TestBed.configureTestingModule({
      imports: [KeykeeperMspMemberHealthComponent],
      providers: [
        provideRouter([]),
        { provide: OrganizationUserApiService, useValue: users },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).compileComponents();
    users.getAllMiniUserDetails.mockRejectedValue(new Error("offline"));
    fixture = TestBed.createComponent(KeykeeperMspMemberHealthComponent);
    fixture.componentRef.setInput("client", CONTOSO);
    fixture.componentRef.setInput("view", {
      organizationId: "contoso",
      on: true,
      members: [numbers("m-ana", { logins: 4, weak: 1, reused: 2, exposed: 1 })],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain("Couldn't load Contoso's members.");
    expect(rows()).toEqual([]);
  });
});
