import { TemplatePortal } from "@angular/cdk/portal";
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  BitwardenIcon,
  BulkActionsBarComponent,
  BulkActionComponent,
  BulkAdditionalActionComponent,
  LayoutFooterService,
} from "@bitwarden/components";

import { VaultBatchBarService } from "../../services/vault-batch-bar.service";
import { Vfo1TerminologyService } from "../../services/vfo1-terminology.service";

type ActionDescriptor = {
  action: () => void;
  icon: BitwardenIcon;
  label: string;
  color?: string;
};

// Keykeeper: upstream split at more than 3 actions and kept 2 as buttons,
// which put Delete, always the last, in the menu as soon as someone belonged
// to an organization. Five fit as buttons; when the window is too narrow for
// them the bar packs the last ones into the menu by itself.
/** When the total number of available actions exceeds this, split into primary + overflow. */
const PRIMARY_ACTION_THRESHOLD = 5;
/** Number of actions shown as primary buttons before the rest move to the overflow menu. */
const PRIMARY_ACTION_COUNT = 4;

@Component({
  selector: "bit-vault-batch-action",
  templateUrl: "./vault-batch-action.component.html",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BulkActionsBarComponent, BulkActionComponent, BulkAdditionalActionComponent],
})
export class VaultBatchActionComponent implements OnDestroy {
  protected readonly service = inject(VaultBatchBarService);
  private readonly i18nService = inject(I18nService);
  private readonly vfo1TerminologyService = inject(Vfo1TerminologyService);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly layoutFooter = inject(LayoutFooterService);

  private readonly barPortal = viewChild.required<TemplateRef<unknown>>("barPortal");
  private readonly portal = signal<TemplatePortal | null>(null);

  constructor() {
    // The bar is `position: fixed`, but it's used within the layout's `cdk-virtual-scrollable`
    // <main>, whose `contain: strict` establishes a containing block — so `fixed` would resolve
    // against <main> and scroll with its content instead of pinning to the viewport. Rendering
    // it into the layout's footer region (a sibling of <main>, outside the scroll container)
    // escapes that containing block while keeping the bar aligned to the main content column.
    afterNextRender(() => {
      const portal = new TemplatePortal(this.barPortal(), this.viewContainerRef);
      this.portal.set(portal);
      this.layoutFooter.attach(portal);
    });
  }

  ngOnDestroy(): void {
    const portal = this.portal();
    if (portal != null) {
      this.layoutFooter.detach(portal);
      this.portal.set(null);
    }
  }

  /** Builds the ordered list of actions the current selection is permitted to perform. */
  private readonly visibleActions = computed<ActionDescriptor[]>(() => {
    const actions: ActionDescriptor[] = [];

    if (this.service.canAddToFolder()) {
      actions.push({
        action: this.service.bulkMoveToFolder.bind(this.service),
        icon: "bwi-folder",
        label: this.i18nService.t("addToFolder"),
      });
    }
    if (this.service.canAssignToCollections()) {
      actions.push({
        action: this.service.bulkAssignToCollections.bind(this.service),
        icon: this.vfo1TerminologyService.iconClass("bwi-collection"),
        label: this.vfo1TerminologyService.enabled()
          ? this.i18nService.t("addToSharedFolder")
          : this.i18nService.t("assignToCollections"),
      });
    }
    // Keykeeper: the star in a single item's menu, for all the selected ones.
    if (this.service.canFavorite()) {
      const adds = this.service.favoriteAdds();
      actions.push({
        action: this.service.bulkFavorite.bind(this.service),
        icon: adds ? "bwi-star" : "bwi-star-f",
        label: this.i18nService.t(adds ? "favorite" : "unfavorite"),
      });
    }
    if (this.service.canEditCollectionAccess()) {
      actions.push({
        action: this.service.bulkEditCollectionAccess.bind(this.service),
        icon: "bwi-users",
        label: this.i18nService.t("editAccess"),
      });
    }
    if (this.service.canArchive()) {
      actions.push({
        action: this.service.bulkArchive.bind(this.service),
        icon: "bwi-archive",
        label: this.i18nService.t("archiveVerb"),
      });
    }
    if (this.service.canUnarchive()) {
      actions.push({
        action: this.service.bulkUnarchive.bind(this.service),
        icon: "bwi-unarchive",
        label: this.i18nService.t("unArchive"),
      });
    }
    if (this.service.canRestore()) {
      actions.push({
        action: this.service.bulkRestore.bind(this.service),
        icon: "bwi-undo",
        label: this.i18nService.t("restore"),
      });
    }
    if (this.service.canDelete()) {
      actions.push({
        action: this.service.bulkDelete.bind(this.service),
        icon: "bwi-trash",
        label: this.i18nService.t(this.service.inTrash() ? "permanentlyDelete" : "delete"),
      });
    }

    return actions;
  });

  /** Keykeeper: true while an action that goes one item at a time is running. */
  protected readonly busy = computed(() => this.service.progress() != null);

  /**
   * Keykeeper: the line above the bar. While an action runs, how far it has
   * got. Otherwise, when the selection has no action at all (every selected
   * item is one the person may only look at), why the bar is empty.
   */
  protected readonly note = computed(() => {
    const progress = this.service.progress();
    if (progress != null) {
      return this.i18nService.t("keykeeperBulkProgress", progress.done, progress.total);
    }
    return this.service.selectedCount() > 0 && this.visibleActions().length === 0
      ? this.i18nService.t("keykeeperBulkNothingAllowed")
      : "";
  });

  /** Actions rendered as top-level buttons. Capped at PRIMARY_ACTION_COUNT when there are more than PRIMARY_ACTION_THRESHOLD total actions. */
  protected readonly primaryActions = computed<ActionDescriptor[]>(() => {
    const all = this.visibleActions();
    return all.length > PRIMARY_ACTION_THRESHOLD ? all.slice(0, PRIMARY_ACTION_COUNT) : all;
  });

  /** Actions hidden behind the "more" overflow menu when the total exceeds PRIMARY_ACTION_THRESHOLD. */
  protected readonly overflowActions = computed<ActionDescriptor[]>(() => {
    const all = this.visibleActions();
    return all.length > PRIMARY_ACTION_THRESHOLD ? all.slice(PRIMARY_ACTION_COUNT) : [];
  });
}
