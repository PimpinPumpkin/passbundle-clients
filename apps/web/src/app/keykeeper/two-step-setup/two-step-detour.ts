import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from "@angular/core";
import { Router } from "@angular/router";

import { SharedModule } from "../../shared";

/**
 * Where someone was when they went to set up two-step login, and what they
 * had typed there: making an MSP or a business organization needs two-step
 * login that counts first (DESIGN.md, "Two-step login for admins"), and
 * without it the server would end their session at once.
 */
export type TwoStepDetour = {
  /** The page to go back to. Only these two, never one from a link. */
  path: "/msp" | "/create-organization";
  /** What the way back says, such as "Set up your MSP". */
  label: string;
  /** The name they'd typed. */
  name: string;
  /** For a new organization, what it's for. */
  preset?: "business" | "none";
};

/**
 * Keykeeper: remembers, for this tab and in memory only, the form someone
 * left to set up two-step login, so the Two-step login page can offer the
 * way back and the form comes back as they left it.
 */
@Injectable({ providedIn: "root" })
export class KeykeeperTwoStepDetour {
  private readonly router = inject(Router);
  private readonly detour = signal<TwoStepDetour | null>(null);
  readonly current = this.detour.asReadonly();

  /** Goes to the Two-step login page, remembering the way back. */
  async start(detour: TwoStepDetour) {
    this.detour.set(detour);
    await this.router.navigate(["/settings/security/two-factor"]);
  }

  /** The form left on this page, once: coming back takes it. */
  take(path: TwoStepDetour["path"]): TwoStepDetour | null {
    const detour = this.detour();
    if (detour?.path !== path) {
      return null;
    }
    this.detour.set(null);
    return detour;
  }

  async goBack() {
    const detour = this.detour();
    if (detour != null) {
      await this.router.navigate([detour.path]);
    }
  }
}

/** Keykeeper: on the Two-step login page, the way back to the form someone left to come here. */
@Component({
  selector: "app-keykeeper-two-step-detour",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (detour.current(); as d) {
      <bit-callout type="info" [title]="null" data-testid="two-step-detour">
        <p>
          Turn on an authenticator app, a security key or passkey, or Duo below (email codes don't
          count here), then go back to finish: {{ d.name }} is still filled in.
        </p>
        <button bitButton buttonType="primary" type="button" (click)="detour.goBack()">
          Back to {{ d.label }}
        </button>
      </bit-callout>
    }
  `,
})
export class KeykeeperTwoStepDetourComponent {
  protected readonly detour = inject(KeykeeperTwoStepDetour);
}
