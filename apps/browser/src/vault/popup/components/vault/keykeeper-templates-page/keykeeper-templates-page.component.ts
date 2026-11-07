import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { CipherType } from "@bitwarden/common/vault/enums";
import {
  ItemTemplate,
  KeykeeperTemplateChooserComponent,
  TemplateBase,
  templateCipherType,
} from "@bitwarden/vault";

import { PopupHeaderComponent } from "../../../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../../../platform/popup/layout/popup-page.component";
import { AddEditQueryParams } from "../add-edit/add-edit.component";

/**
 * Keykeeper: choose a template for a new item, or start a new custom template,
 * then continue on the add item page. Keeps the folder, organization, and
 * collection the person was adding to.
 */
@Component({
  selector: "app-keykeeper-templates-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PopupPageComponent, PopupHeaderComponent, KeykeeperTemplateChooserComponent],
  template: `
    <popup-page>
      <popup-header
        slot="header"
        [pageTitle]="creating() ? 'New template' : 'New item from a template'"
        [showBackButton]="true"
      ></popup-header>
      <section class="tw-px-3 tw-py-2">
        <vault-keykeeper-template-chooser
          [(creating)]="creating"
          (chosen)="use($event)"
          (createRequested)="create($event)"
        ></vault-keykeeper-template-chooser>
      </section>
    </popup-page>
  `,
})
export class KeykeeperTemplatesPageComponent {
  protected readonly creating = signal(false);

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  protected use(template: ItemTemplate) {
    this.addItem({
      type: templateCipherType(template).toString(),
      ...(template.source
        ? { keykeeperTemplateItem: template.source.cipherId }
        : { keykeeperTemplate: template.id }),
    });
  }

  protected create(base: TemplateBase) {
    this.addItem({ type: CipherType.SecureNote.toString(), keykeeperNewTemplate: base });
  }

  private addItem(params: AddEditQueryParams) {
    const { folderId, organizationId, collectionIds } = this.route.snapshot.queryParams;
    void this.router.navigate(["/add-cipher"], {
      queryParams: { folderId, organizationId, collectionIds, ...params },
    });
  }
}
