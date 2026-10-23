import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { By } from "@angular/platform-browser";
import { ActivatedRoute } from "@angular/router";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, Subject } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { MessageSender } from "@bitwarden/common/platform/messaging";
import { StateProvider } from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { SearchService } from "@bitwarden/common/vault/abstractions/search.service";
import { VaultSettingsService } from "@bitwarden/common/vault/abstractions/vault-settings/vault-settings.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { PasswordRepromptService } from "@bitwarden/vault";

import { AutofillService } from "../../../../../autofill/services/abstractions/autofill.service";
import { VaultPopupItemsService } from "../../../services/vault-popup-items.service";
import {
  PopupListFilter,
  VaultPopupListFiltersService,
} from "../../../services/vault-popup-list-filters.service";
import { VaultPopupLoadingService } from "../../../services/vault-popup-loading.service";
import { KeykeeperCategoryChipsComponent } from "../keykeeper-category-chips/keykeeper-category-chips.component";

import { VaultHeaderComponent } from "./vault-header.component";

@Component({
  selector: "app-keykeeper-category-chips",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class KeykeeperCategoryChipsStubComponent {}

describe("VaultHeaderComponent", () => {
  let component: VaultHeaderComponent;
  let fixture: ComponentFixture<VaultHeaderComponent>;

  const emptyForm: PopupListFilter = {
    organization: null,
    collection: null,
    folder: null,
    cipherType: null,
  };

  // Keykeeper: the button's badge counts the filters behind it: vaults,
  // collections, and folders. The kind of item is the chips'.
  const filters$ = new BehaviorSubject<PopupListFilter>(emptyForm);
  const allFilters$ = new BehaviorSubject<unknown[][]>([[], [], [{ value: { id: "folder" } }]]);
  const state$ = new Subject<boolean | null>();
  const folder = { id: "folder" } as FolderView;
  const collection = { id: "collection" } as PopupListFilter["collection"];
  const organization = { id: "organization" } as PopupListFilter["organization"];

  // Mock state provider update
  const update = jest.fn().mockResolvedValue(undefined);

  /** When it exists, returns the notification badge debug element */
  const getBadge = () => fixture.debugElement.query(By.css('[data-testid="filter-badge"]'));

  beforeEach(async () => {
    update.mockClear();
    filters$.next(emptyForm);
    allFilters$.next([[], [], [{ value: { id: "folder" } }]]);

    await TestBed.configureTestingModule({
      imports: [VaultHeaderComponent, CommonModule],
      providers: [
        {
          provide: CipherService,
          useValue: mock<CipherService>({
            cipherViews$: jest.fn().mockReturnValue(new BehaviorSubject([])),
          }),
        },
        { provide: VaultSettingsService, useValue: mock<VaultSettingsService>() },
        { provide: FolderService, useValue: mock<FolderService>() },
        { provide: OrganizationService, useValue: mock<OrganizationService>() },
        { provide: CollectionService, useValue: mock<CollectionService>() },
        { provide: PolicyService, useValue: mock<PolicyService>() },
        { provide: SearchService, useValue: mock<SearchService>() },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        { provide: AutofillService, useValue: mock<AutofillService>() },
        { provide: PasswordRepromptService, useValue: mock<PasswordRepromptService>() },
        { provide: MessageSender, useValue: mock<MessageSender>() },
        { provide: AccountService, useValue: mock<AccountService>() },
        { provide: LogService, useValue: mock<LogService>() },
        {
          provide: ConfigService,
          useValue: { getFeatureFlag$: jest.fn(() => new BehaviorSubject(true)) },
        },
        {
          provide: VaultPopupItemsService,
          useValue: mock<VaultPopupItemsService>({ searchText$: new BehaviorSubject("") }),
        },
        {
          provide: SyncService,
          useValue: mock<SyncService>({ activeUserLastSync$: () => new Subject() }),
        },
        { provide: ActivatedRoute, useValue: { queryParams: new BehaviorSubject({}) } },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: VaultPopupListFiltersService,
          useValue: {
            filters$,
            allFilters$,
            filterForm: new FormBuilder().group(emptyForm),
            filterVisibilityState$: state$,
            updateFilterVisibility: update,
          },
        },
        {
          provide: StateProvider,
          useValue: { getGlobal: () => ({ state$, update }) },
        },
        {
          provide: VaultPopupLoadingService,
          useValue: { loading$: new BehaviorSubject(false) },
        },
      ],
    })
      .overrideComponent(VaultHeaderComponent, {
        remove: { imports: [KeykeeperCategoryChipsComponent] },
        add: { imports: [KeykeeperCategoryChipsStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(VaultHeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("does not show filter badge when no filters are selected", () => {
    state$.next(false);
    filters$.next(emptyForm);
    fixture.detectChanges();

    expect(getBadge()).toBeNull();
  });

  it("does not show filter badge when disclosure is open", () => {
    state$.next(true);
    filters$.next({ ...emptyForm, folder });
    fixture.detectChanges();

    expect(getBadge()).toBeNull();
  });

  it("shows the notification badge when there are populated filters and the disclosure is closed", async () => {
    state$.next(false);
    filters$.next({ ...emptyForm, folder });
    fixture.detectChanges();

    expect(getBadge()).not.toBeNull();
  });

  it("displays the number of filters populated", () => {
    filters$.next({ ...emptyForm, folder });
    state$.next(false);
    fixture.detectChanges();

    expect(getBadge().nativeElement.textContent.trim()).toBe("1");

    filters$.next({ ...emptyForm, folder, collection });

    fixture.detectChanges();

    expect(getBadge().nativeElement.textContent.trim()).toBe("2");

    filters$.next({ ...emptyForm, folder, collection, organization });

    fixture.detectChanges();

    expect(getBadge().nativeElement.textContent.trim()).toBe("3");
  });

  it("doesn't count the kind of item, which the chips show", () => {
    state$.next(false);
    filters$.next({ ...emptyForm, cipherType: CipherType.Card });
    fixture.detectChanges();

    expect(getBadge()).toBeNull();
  });

  it("shows the filters button only when there are vaults, collections, or folders to pick", () => {
    const button = () => fixture.debugElement.query(By.css('[bitIconButton="bwi-sliders"]'));
    fixture.detectChanges();
    expect(button()).not.toBeNull();

    allFilters$.next([[], [], []]);
    fixture.detectChanges();
    expect(button()).toBeNull();
  });

  it("defaults the initial state to closed", (done) => {
    // The initial value of the `state$` variable above is undefined
    component["initialDisclosureVisibility$"].subscribe((initialVisibility) => {
      expect(initialVisibility).toBe(false);
      done();
    });

    // Update the state to null
    state$.next(null);
  });
});
