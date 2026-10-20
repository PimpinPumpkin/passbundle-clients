import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from "@angular/core";

import { ButtonModule, CalloutModule, TypographyModule } from "@bitwarden/components";

import { PopupFooterComponent } from "../../platform/popup/layout/popup-footer.component";
import { PopupHeaderComponent } from "../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../platform/popup/layout/popup-page.component";
import { JOIN_ANSWER_KEY, JOIN_REQUEST_KEY, JoinAnswer, StoredJoinRequest } from "../join-request";

/**
 * Keykeeper: asks the person once whether to join the organization the
 * install command named, before the extension joins it. Says what joining
 * means, and what account recovery lets the organization's admins do. See
 * enrollment.ts and DESIGN.md, "Onboarding through the RMM".
 */
@Component({
  selector: "app-keykeeper-join-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PopupPageComponent,
    PopupHeaderComponent,
    PopupFooterComponent,
    ButtonModule,
    CalloutModule,
    TypographyModule,
  ],
  template: `
    <popup-page>
      <popup-header slot="header" [pageTitle]="title()"></popup-header>
      @if (request(); as r) {
        <section class="tw-px-1 tw-py-2" data-testid="keykeeper-join">
          <p bitTypography="body1">
            Your IT set up this browser so you can join {{ r.organizationName }}. Once an admin
            confirms you, you'll see what {{ r.organizationName }} shares with you.
          </p>
          @if (r.accountRecovery) {
            <bit-callout type="warning" title="Account recovery">
              {{ r.organizationName }}'s admins will be able to reset your master password if you
              forget it, and whoever resets it can then sign in to your account.
              @if (r.adminElsewhere.length) {
                You're an owner or admin of {{ list(r.adminElsewhere) }}, which that would reach
                too, so consider joining with a separate account.
              }
            </bit-callout>
            @if (r.fingerprint) {
              <p bitTypography="helper">
                {{ r.organizationName }}'s fingerprint phrase:
                <span class="tw-font-mono" data-testid="keykeeper-join-fingerprint">{{
                  r.fingerprint.join("-")
                }}</span>
              </p>
            }
          }
        </section>
      } @else if (loaded()) {
        <p bitTypography="body1" class="tw-px-1 tw-py-2">There's nothing to join right now.</p>
      }
      <popup-footer slot="footer">
        <div class="tw-flex tw-gap-2">
          @if (request()) {
            <button bitButton buttonType="primary" type="button" (click)="answer(true)">
              Join
            </button>
          }
          <button bitButton buttonType="secondary" type="button" (click)="answer(false)">
            {{ request() ? "Not now" : "Close" }}
          </button>
        </div>
      </popup-footer>
    </popup-page>
  `,
})
export class KeykeeperJoinPageComponent implements OnInit {
  protected readonly request = signal<StoredJoinRequest | null>(null);
  protected readonly loaded = signal(false);
  protected readonly title = computed(() => {
    const request = this.request();
    return request ? `Join ${request.organizationName}?` : "Join an organization";
  });

  async ngOnInit() {
    const stored = (await chrome.storage.session.get(JOIN_REQUEST_KEY))[JOIN_REQUEST_KEY];
    this.request.set((stored as StoredJoinRequest | undefined) ?? null);
    this.loaded.set(true);
  }

  protected list(names: string[]): string {
    return names.length < 2
      ? names.join("")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  protected async answer(join: boolean) {
    const request = this.request();
    if (request != null) {
      const answer: JoinAnswer = { id: request.id, join };
      await chrome.storage.session.set({ [JOIN_ANSWER_KEY]: answer });
    }
    window.close();
  }
}
