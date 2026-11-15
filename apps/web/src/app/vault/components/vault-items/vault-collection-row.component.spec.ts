import { ScrollingModule } from "@angular/cdk/scrolling";
import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { RouterModule } from "@angular/router";
import { mock } from "jest-mock-extended";

import { PremiumBadgeComponent } from "@bitwarden/angular/billing/components/premium-badge";
import {
  CollectionAccessSelectionView,
  CollectionAdminView,
  CollectionView,
} from "@bitwarden/common/admin-console/models/collections";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CollectionId, OrganizationId } from "@bitwarden/common/types/guid";
import {
  IconModule,
  ScrollLayoutDirective,
  TableModule,
  TooltipDirective,
} from "@bitwarden/components";
import { ShareLinkMenuItemDirective } from "@bitwarden/tools-share";
import {
  CopyCipherFieldDirective,
  VaultItemCopyActionsComponent,
  Vfo1I18nPipe,
  Vfo1IconPipe,
  Vfo1TerminologyService,
} from "@bitwarden/vault";

import { CollectionNameBadgeComponent } from "../../../admin-console/organizations/collections";
import { GroupNameBadgeComponent } from "../../../admin-console/organizations/collections/group-badge/group-name-badge.component";
import { GroupView } from "../../../admin-console/organizations/core";
import { SharedModule } from "../../../shared/shared.module";
import { OrganizationBadgeModule } from "../../individual-vault/organization-badge/organization-badge.module";
import { PipesModule } from "../../individual-vault/pipes/pipes.module";

import { VaultCollectionRowComponent } from "./vault-collection-row.component";

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<table>
    <tbody>
      <tr
        appVaultCollectionRow
        [collection]="collection"
        [groups]="groups"
        [showGroups]="true"
        [organizations]="[]"
        [canEditCollection]="canEdit"
        (checkedToggled)="held.push($event)"
      ></tr>
    </tbody>
  </table>`,
  standalone: false,
})
class HostComponent {
  collection!: CollectionView;
  groups: GroupView[] = [];
  canEdit = false;
  held: boolean[] = [];
}

describe("VaultCollectionRowComponent group badges", () => {
  let fixture: ComponentFixture<HostComponent>;

  const group = (id: string, name: string) => new GroupView({ id, organizationId: "org-id", name });

  async function setup(collectionGroupIds: string[], groups: GroupView[], canEdit = false) {
    const i18nService = mock<I18nService>();
    i18nService.collator = new Intl.Collator("en");
    i18nService.t.mockImplementation((key) => key);

    const vfo1TerminologyService = mock<Vfo1TerminologyService>();
    (vfo1TerminologyService as any).enabled = () => false;
    vfo1TerminologyService.iconClass.mockImplementation((icon) => icon);

    await TestBed.configureTestingModule({
      declarations: [HostComponent, VaultCollectionRowComponent],
      // Mirrors VaultItemsModule's imports, which is where this row is declared in production.
      imports: [
        CommonModule,
        RouterModule.forRoot([]),
        ScrollingModule,
        SharedModule,
        TableModule,
        TooltipDirective,
        OrganizationBadgeModule,
        CollectionNameBadgeComponent,
        GroupNameBadgeComponent,
        PipesModule,
        CopyCipherFieldDirective,
        VaultItemCopyActionsComponent,
        ScrollLayoutDirective,
        PremiumBadgeComponent,
        IconModule,
        Vfo1I18nPipe,
        Vfo1IconPipe,
        ShareLinkMenuItemDirective,
      ],
      providers: [
        { provide: I18nService, useValue: i18nService },
        { provide: Vfo1TerminologyService, useValue: vfo1TerminologyService },
      ],
    }).compileComponents();

    const collection = new CollectionAdminView({
      id: "collection-id" as CollectionId,
      organizationId: "org-id" as OrganizationId,
      name: "Shared Collection",
    });
    collection.groups = collectionGroupIds.map((id) => ({ id }) as CollectionAccessSelectionView);

    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.collection = collection;
    fixture.componentInstance.groups = groups;
    fixture.componentInstance.canEdit = canEdit;
    fixture.detectChanges();
  }

  const renderedBadges = () =>
    Array.from(
      fixture.nativeElement.querySelectorAll(
        "app-group-badge span[bitBadge]",
      ) as NodeListOf<HTMLElement>,
    )
      .map((badge) => badge.textContent?.trim())
      .filter((text): text is string => !!text);

  it("renders the group name badges for a collection row", async () => {
    await setup(
      ["group-1", "group-2"],
      [group("group-1", "Engineering"), group("group-2", "Accounting")],
    );

    expect(fixture.nativeElement.querySelector("app-group-badge")).not.toBeNull();
    expect(renderedBadges()).toEqual(["Accounting", "Engineering"]);
  });

  it("renders no badges when the collection has no groups", async () => {
    await setup([], [group("group-1", "Engineering")]);

    expect(renderedBadges()).toEqual([]);
  });

  // Keykeeper: selecting several items (DESIGN.md, "Selecting several items").
  describe("the row's checkbox", () => {
    const checkbox = () =>
      fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;

    it("names the shared folder it selects", async () => {
      await setup([], [], true);
      const t = TestBed.inject(I18nService).t as jest.Mock;

      expect(checkbox().getAttribute("aria-label")).toBe("keykeeperSelectItem");
      expect(t.mock.calls.find(([key]) => key === "keykeeperSelectItem")?.[1]).toBe(
        "Shared Collection",
      );
    });

    it("says whether Shift was held when it is clicked, and lets the click through", async () => {
      await setup([], [], true);
      const withShift = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      });
      const plain = new MouseEvent("click", { bubbles: true, cancelable: true });

      checkbox().dispatchEvent(withShift);
      checkbox().dispatchEvent(plain);

      expect(fixture.componentInstance.held).toEqual([true, false]);
      // Neither click is canceled: a canceled one leaves the checkbox as it was.
      expect(withShift.defaultPrevented).toBe(false);
      expect(plain.defaultPrevented).toBe(false);
    });
  });
});
