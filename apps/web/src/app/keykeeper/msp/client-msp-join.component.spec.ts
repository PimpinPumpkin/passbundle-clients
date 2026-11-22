import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";

import { LinkPreview } from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { KeykeeperClientMspJoinComponent } from "./client-msp-join.component";
import { KeykeeperMspApiService } from "./msp-api.service";

const CODE = "7KQ2-MXP4-ZT9W-HN3R-VB8C-J5DF";

/** Ours from brand/messages.en.json (a key that isn't there fails), upstream's as their keys. */
const keykeeperI18n = {
  t: (key: string, ...values: string[]) =>
    key.startsWith("keykeeper") ? translate(key, ...values) : key,
  translationLocale: "en-US",
};

const preview = (current: LinkPreview["current"] = null): LinkPreview => ({
  msp: { id: "msp-1", name: "Northwind IT" },
  current,
  adding: [
    { email: "dana@northwind.test", name: "Dana", role: "owner" },
    { email: "sam@northwind.test", name: null, role: "admin" },
  ],
  stayingOut: [],
});

describe("KeykeeperClientMspJoinComponent, what an owner reads before and after joining an MSP", () => {
  let fixture: ComponentFixture<KeykeeperClientMspJoinComponent>;
  let mspApi: MockProxy<KeykeeperMspApiService>;
  let toast: MockProxy<ToastService>;

  afterEach(() => TestBed.resetTestingModule());

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Opens the form, types the code, and checks it, as an owner does. */
  async function enterCode(shown: LinkPreview) {
    mspApi = mock<KeykeeperMspApiService>();
    mspApi.previewLink.mockResolvedValue(shown);
    mspApi.joinWithCode.mockResolvedValue({
      msp: shown.msp,
      added: shown.adding.length,
      moved: null,
    });
    toast = mock<ToastService>();
    await TestBed.configureTestingModule({
      imports: [KeykeeperClientMspJoinComponent],
      providers: [
        { provide: I18nService, useValue: keykeeperI18n },
        { provide: KeykeeperMspApiService, useValue: mspApi },
        { provide: DialogService, useValue: mock<DialogService>() },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperClientMspJoinComponent);
    fixture.componentRef.setInput("organization", {
      id: "org-1",
      name: "Acme Dental",
      isOwner: true,
      keykeeperFromMsp: false,
    } as Organization);
    fixture.componentRef.setInput("hasMsp", shown.current != null);
    await settle();
    page().querySelector<HTMLButtonElement>('[data-testid="client-msp-join-open"]')!.click();
    await settle();
    const input = page().querySelector<HTMLInputElement>("form input")!;
    input.value = CODE;
    input.dispatchEvent(new Event("input"));
    page().querySelector("form")!.dispatchEvent(new Event("submit"));
    await settle();
  }

  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().querySelector('[data-testid="client-msp-join"]')!.textContent!;
  const said = () => text().replace(/\s+/g, " ");

  it("says an owner confirms one of the MSP's admins after comparing phrases, and the rest come in without anyone comparing", async () => {
    await enterCode(preview());
    expect(mspApi.previewLink).toHaveBeenCalledWith("org-1", CODE);
    expect(said()).toContain("Join Northwind IT?");
    expect(said()).toContain(
      "Northwind IT's people below are added to Acme Dental. None of them can open its items until they're confirmed. First an owner here confirms one of Northwind IT's admins, on this page, after comparing their fingerprint phrase with what they read you.",
    );
    expect(said()).toContain(
      "Once that admin confirms Acme Dental in their MSP console, the rest of Northwind IT's people, and anyone it adds later, are let in automatically, without anyone here comparing their phrases, as long as Acme Dental lets people in when they accept an invitation (Settings, Joining and security). Each one is listed under What Northwind IT did here, on this page.",
    );
    expect(said()).not.toContain("confirms each of them");
  });

  it("says the same before a move to another MSP, after what goes with the one it has now", async () => {
    await enterCode(preview({ id: "msp-2", name: "Contoso IT" }));
    expect(said()).toContain("Move to Northwind IT?");
    expect(said()).toContain("Contoso IT manages Acme Dental now.");
    expect(said()).toContain("First an owner here confirms one of Northwind IT's admins");
    expect(said()).toContain("the rest of Northwind IT's people, and anyone it adds later");
    expect(said()).not.toContain("confirms each of them");
  });

  it("once joined, asks the owner to confirm the MSP's admin, not everyone it added", async () => {
    await enterCode(preview());
    const join = Array.from(page().querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent!.trim() === "Join Northwind IT",
    )!;
    join.click();
    await settle();
    expect(mspApi.joinWithCode).toHaveBeenCalledWith("org-1", CODE, false);
    expect(toast.showToast).toHaveBeenCalledWith({
      variant: "success",
      message:
        "Northwind IT now manages Acme Dental. Confirm Dana (dana@northwind.test) below once you've compared their phrase.",
    });
  });
});
