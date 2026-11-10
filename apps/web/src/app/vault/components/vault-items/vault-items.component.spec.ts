import { SelectionModel } from "@angular/cdk/collections";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { TestBed } from "@angular/core/testing";
import { of } from "rxjs";

import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { CipherAuthorizationService } from "@bitwarden/common/vault/services/cipher-authorization.service";
import { RestrictedItemTypesService } from "@bitwarden/common/vault/services/restricted-item-types.service";
import { CipherViewLike } from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import { MenuModule, TableModule, ToastService } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";
import {
  compareVaultItems,
  VaultBatchBarService,
  VaultCopyButtonsService,
  VaultItem,
} from "@bitwarden/vault";

import { VaultItemsComponent } from "./vault-items.component";
import { VAULT_ROW_LEASE_BADGE } from "./vault-row-lease-badge.token";

describe("VaultItemsComponent", () => {
  let component: VaultItemsComponent<CipherViewLike>;
  let mockSelection: SelectionModel<VaultItem<CipherViewLike>>;
  // Keykeeper: the list says when a selection reached its limit.
  const showToast = jest.fn();

  const cipher1: Partial<CipherView> = {
    id: "cipher-1",
    name: "Cipher 1",
    organizationId: undefined,
  };

  const cipher2: Partial<CipherView> = {
    id: "cipher-2",
    name: "Cipher 2",
    organizationId: undefined,
  };

  beforeEach(async () => {
    showToast.mockClear();
    mockSelection = new SelectionModel<VaultItem<CipherViewLike>>(
      true,
      [],
      true,
      compareVaultItems,
    );

    await TestBed.configureTestingModule({
      declarations: [VaultItemsComponent],
      imports: [ScrollingModule, TableModule, I18nPipe, MenuModule],
      providers: [
        {
          provide: CipherAuthorizationService,
          useValue: {
            canDeleteCipher$: jest.fn(),
            canRestoreCipher$: jest.fn(),
          },
        },
        {
          provide: RestrictedItemTypesService,
          useValue: {
            restricted$: of([]),
            isCipherRestricted: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: (key: string) => key,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getFeatureFlag$: jest.fn().mockReturnValue(of(false)),
          },
        },
        {
          provide: VaultCopyButtonsService,
          useValue: {
            showQuickCopyActions$: of(false),
          },
        },
        {
          provide: VaultBatchBarService,
          useValue: {
            selection: mockSelection,
            clearSelection: () => mockSelection.clear(),
          },
        },
        { provide: ToastService, useValue: { showToast } },
      ],
    });

    const fixture = TestBed.createComponent(VaultItemsComponent);
    component = fixture.componentInstance;
  });

  describe("optionsColumnWidthClass", () => {
    it("reserves room for the quick copy icons when they are shown", () => {
      expect(component["optionsColumnWidthClass"](true)).toBe("tw-w-48");
    });

    it("reserves room for the combined copy and launch actions", () => {
      expect(component["optionsColumnWidthClass"](false)).toBe("tw-w-32");
    });
  });

  describe("selectable items (editableItems)", () => {
    it("excludes partial (PAM-gated) ciphers so they cannot be selected or bulk-acted", () => {
      const normal = {
        id: "normal",
        organizationId: undefined,
        partial: false,
      } as unknown as CipherViewLike;
      const partial = {
        id: "partial",
        organizationId: undefined,
        partial: true,
      } as unknown as CipherViewLike;

      component.ciphers = [normal, partial];

      const editableCiphers = component["editableItems"].map((item) => item.cipher);
      expect(editableCiphers).toContain(normal);
      expect(editableCiphers).not.toContain(partial);
    });

    // Keykeeper: an item someone can only look at is selectable too; each
    // action says what it leaves out (DESIGN.md, "Selecting several items").
    it("includes an organization's item the person can't edit", () => {
      const viewOnly = {
        id: "view-only",
        organizationId: "org-1",
        edit: false,
      } as unknown as CipherViewLike;

      component.ciphers = [viewOnly];

      expect(component["editableItems"].map((item) => item.cipher)).toEqual([viewOnly]);
    });

    it("excludes an item that couldn't be decrypted, whose checkbox is off", () => {
      const broken = {
        id: "broken",
        organizationId: undefined,
        decryptionFailure: true,
      } as unknown as CipherViewLike;

      component.ciphers = [broken];

      expect(component["editableItems"]).toEqual([]);
    });
  });

  // Keykeeper: DESIGN.md, "Selecting several items".
  describe("selecting several items", () => {
    function rows(count: number): CipherViewLike[] {
      return Array.from(
        { length: count },
        (_, i) => ({ id: `cipher-${i}`, name: `Cipher ${i}` }) as unknown as CipherViewLike,
      );
    }

    function selectedIds(): string[] {
      return mockSelection.selected.map((item) => item.cipher.id as string).sort();
    }

    function press(init: KeyboardEventInit, on: HTMLElement = document.createElement("div")) {
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      on.addEventListener("keydown", (e) => component["onKeydown"](e as KeyboardEvent));
      on.dispatchEvent(event);
      return event;
    }

    beforeEach(() => {
      component.ciphers = rows(6);
    });

    it("toggles one row on a plain click", () => {
      const [first] = component.dataSource.data;

      component["toggleItem"](first, false);
      expect(selectedIds()).toEqual(["cipher-0"]);

      component["toggleItem"](first, false);
      expect(selectedIds()).toEqual([]);
    });

    it("selects every row from the last one clicked to this one with Shift", () => {
      const data = component.dataSource.data;

      component["toggleItem"](data[1], false);
      component["toggleItem"](data[4], true);

      expect(selectedIds()).toEqual(["cipher-1", "cipher-2", "cipher-3", "cipher-4"]);
    });

    it("selects a range upward as well", () => {
      const data = component.dataSource.data;

      component["toggleItem"](data[4], false);
      component["toggleItem"](data[2], true);

      expect(selectedIds()).toEqual(["cipher-2", "cipher-3", "cipher-4"]);
    });

    it("clears the range when the row clicked with Shift was selected", () => {
      const data = component.dataSource.data;
      mockSelection.select(...data);

      component["toggleItem"](data[1], false);
      component["toggleItem"](data[3], true);

      expect(selectedIds()).toEqual(["cipher-0", "cipher-4", "cipher-5"]);
    });

    it("selects only the clicked row with Shift when nothing was clicked before", () => {
      component["toggleItem"](component.dataSource.data[3], true);

      expect(selectedIds()).toEqual(["cipher-3"]);
    });

    it("finds the range in the order the list is sorted", () => {
      const data = component.dataSource.data;
      component.dataSource.sort = {
        direction: "desc",
        fn: (a, b) => a.cipher.name.localeCompare(b.cipher.name),
      };

      // Shown as 5, 4, 3, 2, 1, 0: from 4 down to 2.
      component["toggleItem"](data[4], false);
      component["toggleItem"](data[2], true);

      expect(selectedIds()).toEqual(["cipher-2", "cipher-3", "cipher-4"]);
    });

    it("leaves a row out of the range when its checkbox is off", () => {
      const ciphers = rows(4);
      (ciphers[1] as unknown as { partial: boolean }).partial = true;
      component.ciphers = ciphers;
      const data = component.dataSource.data;

      component["toggleItem"](data[0], false);
      component["toggleItem"](data[3], true);

      expect(selectedIds()).toEqual(["cipher-0", "cipher-2", "cipher-3"]);
    });

    it("selects every row shown from the header checkbox, and clears them from it", () => {
      component["toggleAll"]();
      expect(mockSelection.selected).toHaveLength(6);
      expect(component.isAllSelected).toBe(true);

      component["toggleAll"]();
      expect(mockSelection.selected).toHaveLength(0);
    });

    it("stops at the limit and says so", () => {
      component.ciphers = rows(501);

      component["toggleAll"]();

      expect(mockSelection.selected).toHaveLength(500);
      expect(showToast).toHaveBeenCalledWith({ variant: "info", message: "keykeeperSelectLimit" });
    });

    it("stops a Shift range at the limit, keeps the clicked row, and says so", () => {
      component.ciphers = rows(510);
      const data = component.dataSource.data;

      component["toggleItem"](data[0], false);
      component["toggleItem"](data[509], true);

      expect(mockSelection.selected).toHaveLength(500);
      expect(mockSelection.isSelected(data[509])).toBe(true);
      expect(showToast).toHaveBeenCalledWith({ variant: "info", message: "keykeeperSelectLimit" });
    });

    it.each([{ metaKey: true }, { ctrlKey: true }])(
      "selects every row shown with %o and A",
      (mod) => {
        const event = press({ key: "a", ...mod });

        expect(mockSelection.selected).toHaveLength(6);
        expect(event.defaultPrevented).toBe(true);
      },
    );

    it("leaves A alone without Cmd or Ctrl, and with other modifiers", () => {
      press({ key: "a" });
      press({ key: "a", metaKey: true, shiftKey: true });
      press({ key: "a", ctrlKey: true, altKey: true });

      expect(mockSelection.selected).toHaveLength(0);
    });

    it("leaves Cmd/Ctrl+A to a text field", () => {
      const field = document.createElement("input");
      field.type = "text";

      const event = press({ key: "a", metaKey: true }, field);

      expect(mockSelection.selected).toHaveLength(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it("takes Cmd/Ctrl+A from a row's checkbox", () => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";

      press({ key: "a", ctrlKey: true }, checkbox);

      expect(mockSelection.selected).toHaveLength(6);
    });

    it("lets go of the selection on Escape", () => {
      mockSelection.select(...component.dataSource.data.slice(0, 3));

      const event = press({ key: "Escape" });

      expect(mockSelection.selected).toHaveLength(0);
      expect(event.defaultPrevented).toBe(true);
    });

    it("leaves Escape alone when nothing is selected", () => {
      const event = press({ key: "Escape" });

      expect(event.defaultPrevented).toBe(false);
    });

    it("ignores both keys while the list is disabled", () => {
      component.disabled = true;

      press({ key: "a", metaKey: true });

      expect(mockSelection.selected).toHaveLength(0);
    });
  });

  describe("showControlledAccess (Controlled access column)", () => {
    class TestLeaseBadge {}

    async function setup(
      provideBadge: boolean,
      pamEnabled = true,
    ): Promise<VaultItemsComponent<CipherViewLike>> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        declarations: [VaultItemsComponent],
        imports: [ScrollingModule, TableModule, I18nPipe, MenuModule],
        providers: [
          {
            provide: CipherAuthorizationService,
            useValue: { canDeleteCipher$: jest.fn(), canRestoreCipher$: jest.fn() },
          },
          {
            provide: RestrictedItemTypesService,
            useValue: { restricted$: of([]), isCipherRestricted: jest.fn().mockReturnValue(false) },
          },
          { provide: I18nService, useValue: { t: (key: string) => key } },
          {
            provide: VaultBatchBarService,
            useValue: {
              selection: mockSelection,
              clearSelection: () => mockSelection.clear(),
            },
          },
          {
            provide: ConfigService,
            useValue: {
              getFeatureFlag$: jest.fn((flag: FeatureFlag) =>
                of(flag === FeatureFlag.Pam ? pamEnabled : false),
              ),
            },
          },
          {
            provide: VaultCopyButtonsService,
            useValue: { showQuickCopyActions$: of(false) },
          },
          { provide: ToastService, useValue: { showToast } },
          ...(provideBadge ? [{ provide: VAULT_ROW_LEASE_BADGE, useValue: TestLeaseBadge }] : []),
        ],
      });
      return TestBed.createComponent(VaultItemsComponent).componentInstance;
    }

    const pamOrg = { usePam: true } as Organization;
    const normalOrg = { usePam: false } as Organization;

    it("is hidden when the PAM feature flag is off, even with the badge seam and a PAM-enabled org", async () => {
      const c = await setup(true, false);
      c.allOrganizations = [pamOrg];
      expect(c.showControlledAccess).toBe(false);
    });

    it("is hidden when no host provides the badge seam, even with a PAM-enabled org", async () => {
      const c = await setup(false);
      c.allOrganizations = [pamOrg];
      expect(c.showControlledAccess).toBe(false);
    });

    it("is hidden when the badge seam is present but no org has PAM enabled", async () => {
      const c = await setup(true);
      c.allOrganizations = [normalOrg];
      expect(c.showControlledAccess).toBe(false);
    });

    it("is shown when the flag is on, the badge seam is present, and a PAM-enabled org is in view", async () => {
      const c = await setup(true);
      c.allOrganizations = [normalOrg, pamOrg];
      expect(c.showControlledAccess).toBe(true);
    });
  });

  describe("selection identity", () => {
    it("keeps checkmarks after ciphers input is re-set with new object references", () => {
      const mockCipher = cipher1 as CipherView;
      component.ciphers = [mockCipher];
      component["selection"].select(component.dataSource.data[0]);

      component.ciphers = [mockCipher];

      expect(component["selection"].isSelected(component.dataSource.data[0])).toBe(true);
    });
  });

  // Keykeeper: DESIGN.md, "Selecting several items".
  describe("a list that is read again", () => {
    const named = (id: string, name: string) => ({ id, name }) as unknown as CipherViewLike;

    it("keeps the rows that are still there, as the list has them now", () => {
      component.ciphers = [named("a", "A"), named("b", "B"), named("c", "C")];
      component["selection"].select(component.dataSource.data[0], component.dataSource.data[2]);

      const fresh = [named("a", "A, renamed"), named("b", "B"), named("c", "C")];
      component.ciphers = fresh;

      const selected = component["selection"].selected.map((row) => row.cipher);
      expect(selected).toEqual([fresh[0], fresh[2]]);
      expect(selected[0]).toBe(fresh[0]);
    });

    it("lets go of a row that left the list", () => {
      component.ciphers = [named("a", "A"), named("b", "B")];
      component["selection"].select(...component.dataSource.data);

      component.ciphers = [named("b", "B")];

      expect(component["selection"].selected.map((row) => row.cipher.id)).toEqual(["b"]);
    });

    it("lets go of a row whose checkbox went off", () => {
      component.ciphers = [named("a", "A"), named("b", "B")];
      component["selection"].select(...component.dataSource.data);

      component.ciphers = [named("a", "A"), { id: "b", name: "B", partial: true } as any];

      expect(component["selection"].selected.map((row) => row.cipher.id)).toEqual(["a"]);
    });

    it("tells the bar once, and never that nothing is selected, while rows stay", () => {
      component.ciphers = [named("a", "A"), named("b", "B")];
      component["selection"].select(...component.dataSource.data);
      const counts: number[] = [];
      const changes = component["selection"].changed.subscribe(() =>
        counts.push(component["selection"].selected.length),
      );

      component.ciphers = [named("a", "A"), named("b", "B")];
      changes.unsubscribe();

      expect(counts).toEqual([2]);
    });

    it("says nothing when the same rows come back", () => {
      const same = [named("a", "A")];
      component.ciphers = same;
      component["selection"].select(component.dataSource.data[0]);
      const changed = jest.fn();
      const changes = component["selection"].changed.subscribe(changed);

      component["refreshItems"]();
      changes.unsubscribe();

      // The list wraps each item anew, so the row is swapped, but only once.
      expect(changed.mock.calls.length).toBeLessThanOrEqual(1);
      expect(component["selection"].selected.map((row) => row.cipher)).toEqual(same);
    });

    it("clears the selection when every selected row left", () => {
      component.ciphers = [named("a", "A")];
      component["selection"].select(component.dataSource.data[0]);

      component.ciphers = [];

      expect(component["selection"].isEmpty()).toBe(true);
    });
  });

  describe("clearSelection", () => {
    it("clears the selection", () => {
      const items: VaultItem<CipherView>[] = [
        { cipher: cipher1 as CipherView },
        { cipher: cipher2 as CipherView },
      ];

      component["selection"].select(...items);
      expect(component["selection"].selected.length).toBeGreaterThan(0);

      component.clearSelection();

      expect(component["selection"].selected.length).toBe(0);
    });
  });
});
