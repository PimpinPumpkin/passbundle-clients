import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { map } from "rxjs";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

import { StreamingScope } from "./event-streaming";
import { KeykeeperEventStreamingComponent } from "./event-streaming.component";

/**
 * Keykeeper: an organization's Event streaming page, under Reporting, for
 * its owners and admins. See DESIGN.md, "Sending events to security tools".
 */
@Component({
  selector: "app-keykeeper-org-event-streaming",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule, KeykeeperEventStreamingComponent],
  template: `
    <app-header></app-header>
    @if (scope(); as s) {
      <app-keykeeper-event-streaming [scope]="s" />
    }
  `,
})
export class KeykeeperOrgEventStreamingComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly organizationId = toSignal(
    this.route.params.pipe(map((params) => params.organizationId as string)),
  );
  protected readonly scope = computed<StreamingScope | null>(() => {
    const id = this.organizationId();
    return id ? { kind: "organization", id } : null;
  });
}
