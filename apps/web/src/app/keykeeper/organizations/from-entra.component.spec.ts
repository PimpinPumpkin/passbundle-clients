import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { OrganizationUserUserDetailsResponse } from "@bitwarden/admin-console/common";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OrganizationUserView } from "../../admin-console/organizations/core/views/organization-user.view";

import {
  FROM_ENTRA,
  FROM_ENTRA_NOTE,
  FROM_ENTRA_TOOLTIP,
  KeykeeperFromEntraBadgeComponent,
  KeykeeperFromEntraNoteComponent,
} from "./from-entra.component";

/** A member as the server lists them, with or without our field. */
const listed = (extra: Record<string, unknown> = {}) =>
  new OrganizationUserUserDetailsResponse({
    id: "member-id",
    userId: "user-id",
    email: "hire@contoso.example",
    name: "New Hire",
    type: 2,
    status: 2,
    ...extra,
  });

describe("the members list's word that Microsoft Entra ID manages someone", () => {
  it("comes from keykeeperProvisioned on each member", () => {
    expect(
      OrganizationUserView.fromResponse(listed({ keykeeperProvisioned: true }))
        .keykeeperProvisioned,
    ).toBe(true);
    expect(
      OrganizationUserView.fromResponse(listed({ keykeeperProvisioned: false }))
        .keykeeperProvisioned,
    ).toBe(false);
  });

  it("is false from a server that doesn't send it, or sends anything but true", () => {
    expect(OrganizationUserView.fromResponse(listed()).keykeeperProvisioned).toBe(false);
    expect(
      OrganizationUserView.fromResponse(listed({ keykeeperProvisioned: "true" }))
        .keykeeperProvisioned,
    ).toBe(false);
    expect(
      OrganizationUserView.fromResponse(listed({ keykeeperProvisioned: null }))
        .keykeeperProvisioned,
    ).toBe(false);
  });

  it("never changes upstream's fields", () => {
    const view = OrganizationUserView.fromResponse(
      listed({ keykeeperProvisioned: true, externalId: "entra-object-id" }),
    );
    expect(view.claimedByOrganization).toBe(false);
    expect(view.canRemove).toBe(true);
    expect(listed({ keykeeperProvisioned: true, externalId: "entra-object-id" }).externalId).toBe(
      "entra-object-id",
    );
  });
});

describe("KeykeeperFromEntraBadgeComponent", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("says From Microsoft Entra ID, and where to change them", async () => {
    await TestBed.configureTestingModule({
      imports: [KeykeeperFromEntraBadgeComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(KeykeeperFromEntraBadgeComponent);
    fixture.detectChanges();

    const badge: HTMLElement = fixture.nativeElement.querySelector(
      "[data-testid='member-from-entra']",
    );
    expect(badge.textContent?.trim()).toBe("From Microsoft Entra ID");
    expect(FROM_ENTRA).toBe("From Microsoft Entra ID");
    expect(FROM_ENTRA_TOOLTIP).toContain("do it in Entra ID");
    expect(FROM_ENTRA_TOOLTIP).toContain("turn them off, remove them, or change their groups");
  });
});

describe("KeykeeperFromEntraNoteComponent", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("says what Entra ID manages, and what's set here", async () => {
    // The callout reads its default words through I18nService.
    await TestBed.configureTestingModule({
      imports: [KeykeeperFromEntraNoteComponent],
      providers: [{ provide: I18nService, useValue: mock<I18nService>() }],
    }).compileComponents();
    const fixture = TestBed.createComponent(KeykeeperFromEntraNoteComponent);
    fixture.detectChanges();

    const note: HTMLElement = fixture.nativeElement.querySelector(
      "[data-testid='member-from-entra-note']",
    );
    expect(note.textContent).toContain(FROM_ENTRA);
    expect(note.textContent).toContain(FROM_ENTRA_NOTE);
    expect(FROM_ENTRA_NOTE).toContain("turns this member off and removes them when they leave");
    expect(FROM_ENTRA_NOTE).toContain("Their role and shared folders are set here.");
    // Product copy rules: no em dashes.
    expect(FROM_ENTRA_NOTE + FROM_ENTRA_TOOLTIP).not.toContain("—");
  });
});
