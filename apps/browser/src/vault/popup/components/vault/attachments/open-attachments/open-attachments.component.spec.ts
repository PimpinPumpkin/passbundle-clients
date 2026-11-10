import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { Router } from "@angular/router";
import { RouterTestingModule } from "@angular/router/testing";
import { BehaviorSubject, of } from "rxjs";

import {
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { ProductTierType } from "@bitwarden/common/billing/enums";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { CipherId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { AttachmentView } from "@bitwarden/common/vault/models/view/attachment.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogService } from "@bitwarden/components";
import { CipherFormContainer } from "@bitwarden/vault";

import { OpenAttachmentsComponent } from "./open-attachments.component";

describe("OpenAttachmentsComponent", () => {
  let component: OpenAttachmentsComponent;
  let fixture: ComponentFixture<OpenAttachmentsComponent>;
  let router: Router;
  let openNotice: jest.SpyInstance;
  const promptForPremium = jest.fn().mockResolvedValue(null);
  const hasPremiumFromAnySource$ = new BehaviorSubject<boolean>(true);
  const cipherView = Object.assign(new CipherView(), {
    id: "5555-444-3333",
    type: CipherType.Login,
    name: "Test Login",
    login: {
      username: "username",
      password: "password",
    },
  }) as CipherView;

  const org = {
    name: "Test Org",
    productTierType: ProductTierType.Enterprise,
    maxStorageGb: 5,
  } as Organization;

  // The stored item, as the component reads it: its files and its organization.
  const mockCipherService = {
    get: jest.fn().mockImplementation(async () => cipherView),
  };
  const organizations$ = jest.fn().mockReturnValue(of([org]));
  const dialogService = { open: jest.fn() };

  const mockUserId = Utils.newGuid() as UserId;
  const accountService = {
    activeAccount$: of({
      id: mockUserId,
      ...mockAccountInfoWith({
        email: "test@email.com",
        name: "Test User",
      }),
    }),
  };
  const formStatusChange$ = new BehaviorSubject<"enabled" | "disabled">("enabled");

  beforeEach(async () => {
    mockCipherService.get.mockClear();
    organizations$.mockClear();
    promptForPremium.mockClear();
    hasPremiumFromAnySource$.next(true);
    formStatusChange$.next("enabled");
    cipherView.organizationId = "";
    cipherView.attachments = [];
    org.maxStorageGb = 5;
    openNotice = jest
      .spyOn(KeykeeperPlanNoticeDialogComponent, "open")
      .mockReturnValue(undefined as never);

    await TestBed.configureTestingModule({
      imports: [OpenAttachmentsComponent, RouterTestingModule],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: BillingAccountProfileStateService,
          useValue: { hasPremiumFromAnySource$: () => hasPremiumFromAnySource$ },
        },
        {
          provide: CipherService,
          useValue: mockCipherService,
        },
        {
          provide: CipherFormContainer,
          useValue: { formStatusChange$ },
        },
        {
          provide: DialogService,
          useValue: dialogService,
        },
        {
          provide: OrganizationService,
          useValue: { organizations$ },
        },
        {
          provide: AccountService,
          useValue: accountService,
        },
        {
          provide: PremiumUpgradePromptService,
          useValue: { promptForPremium },
        },
      ],
    }).compileComponents();
  });

  beforeEach(async () => {
    fixture = TestBed.createComponent(OpenAttachmentsComponent);
    component = fixture.componentInstance;
    component.cipherId = "5555-444-3333" as CipherId;
    router = TestBed.inject(Router);
    jest.spyOn(router, "navigate").mockResolvedValue(true);
    fixture.detectChanges();
  });

  afterEach(() => {
    openNotice.mockRestore();
  });

  const expectAttachmentsPage = () =>
    expect(router.navigate).toHaveBeenCalledWith(["/attachments"], {
      queryParams: { cipherId: "5555-444-3333" },
    });
  const oneFile = () => [Object.assign(new AttachmentView(), { id: "file-1" })];
  const badge = () => fixture.debugElement.query(By.css("app-premium-badge"));

  it("navigates to attachments route", async () => {
    await component.ngOnInit();

    await component.openAttachments();

    expectAttachmentsPage();
    expect(openNotice).not.toHaveBeenCalled();
  });

  it("shows no Premium badge when a file can be added", async () => {
    await component.ngOnInit();
    fixture.detectChanges();

    expect(component.attachingOff).toBeNull();
    expect(badge()).toBeNull();
  });

  it("disables attachments when the edit form is disabled", () => {
    formStatusChange$.next("disabled");
    fixture.detectChanges();

    let button = fixture.debugElement.query(By.css("button"));

    expect(button.nativeElement.disabled).toBe(true);

    formStatusChange$.next("enabled");
    fixture.detectChanges();

    button = fixture.debugElement.query(By.css("button"));
    expect(button.nativeElement.disabled).toBe(false);
  });

  describe("a personal item without Premium", () => {
    beforeEach(() => {
      hasPremiumFromAnySource$.next(false);
    });

    it("says attaching files is part of Premium when the item has no files", async () => {
      await component.ngOnInit();

      await component.openAttachments();

      expect(openNotice).toHaveBeenCalledTimes(1);
      expect(openNotice.mock.calls[0][1]).toEqual({ sentence: KeykeeperPlanSentence.AttachFiles });
      expect(router.navigate).not.toHaveBeenCalled();
      expect(promptForPremium).not.toHaveBeenCalled();
    });

    it("opens the attachments page when the item has files, so they can be downloaded and removed", async () => {
      cipherView.attachments = oneFile();
      await component.ngOnInit();

      await component.openAttachments();

      expectAttachmentsPage();
      expect(openNotice).not.toHaveBeenCalled();
    });

    it("shows the Premium badge", async () => {
      await component.ngOnInit();
      fixture.detectChanges();

      expect(component.attachingOff).toBe("premium");
      expect(badge()).not.toBeNull();
    });
  });

  describe("an organization's item", () => {
    beforeEach(() => {
      cipherView.organizationId = "888-333-333";
      org.id = cipherView.organizationId as OrganizationId;
    });

    it("opens the attachments page without looking at the person's own plan", async () => {
      hasPremiumFromAnySource$.next(false);
      await component.ngOnInit();
      fixture.detectChanges();

      await component.openAttachments();

      expect(component.attachingOff).toBeNull();
      expect(badge()).toBeNull();
      expectAttachmentsPage();
    });

    it("says the organization's plan has ended when it has no storage and the item has no files", async () => {
      org.maxStorageGb = 0;
      await component.ngOnInit();
      fixture.detectChanges();

      await component.openAttachments();

      expect(component.attachingOff).toBe("organization");
      expect(badge()).toBeNull();
      expect(openNotice).toHaveBeenCalledTimes(1);
      expect(openNotice.mock.calls[0][1]).toEqual({
        sentence: KeykeeperPlanSentence.OrganizationEnded,
      });
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it("opens the attachments page for an item with files when the organization has no storage", async () => {
      org.maxStorageGb = 0;
      cipherView.attachments = oneFile();
      await component.ngOnInit();

      await component.openAttachments();

      expectAttachmentsPage();
      expect(openNotice).not.toHaveBeenCalled();
    });
  });
});
