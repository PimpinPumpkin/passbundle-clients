import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * "3 weeks ago", "yesterday": how long ago `then` was, in the largest whole
 * unit, or `justNow` for less than a minute.
 */
export function keykeeperTimeAgo(then: Date, now: Date, locale: string, justNow: string): string {
  const seconds = (then.getTime() - now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.trunc(seconds / size), unit);
    }
  }
  return justNow;
}

/**
 * Keykeeper: a quiet line under a login's fields in the extension (DESIGN.md,
 * "The look"): how strong its password is and when it last changed, "Password
 * strong · changed 3 weeks ago". Strength is zxcvbn's score, as in the
 * password health report: 4 strong, 3 good, anything less weak.
 */
@Component({
  selector: "vault-keykeeper-password-health-line",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (line(); as l) {
      <p [attr.data-weak]="l.weak || null" data-testid="keykeeper-password-health">
        {{ l.text }}
      </p>
    }
  `,
  styles: `
    p {
      margin: 0 0 12px;
      padding: 0 4px;
      font-size: 12px;
      color: var(--pb-muted, rgb(var(--color-text-muted)));
    }
    p[data-weak] {
      color: var(--color-fg-danger, rgb(var(--color-danger-600)));
    }
  `,
})
export class KeykeeperPasswordHealthLineComponent {
  private readonly i18nService = inject(I18nService);
  private readonly passwordStrengthService = inject(PasswordStrengthServiceAbstraction);

  readonly cipher = input.required<CipherView>();

  protected readonly line = computed(() => {
    const cipher = this.cipher();
    const password = cipher.login?.password;
    if (!password || !cipher.viewPassword) {
      return null;
    }
    const score = this.passwordStrengthService.getPasswordStrength(
      password,
      undefined,
      [cipher.login.username, cipher.name].filter((s): s is string => !!s),
    ).score;
    const strength =
      score >= 4
        ? "keykeeperPasswordStrong"
        : score === 3
          ? "keykeeperPasswordGood"
          : "keykeeperPasswordWeak";
    const changed = cipher.login.passwordRevisionDate;
    const since = changed ?? cipher.creationDate;
    const parts = [this.i18nService.t(strength)];
    if (since) {
      const ago = keykeeperTimeAgo(
        new Date(since),
        new Date(),
        this.i18nService.translationLocale ?? "en",
        this.i18nService.t("keykeeperJustNow"),
      );
      parts.push(
        this.i18nService.t(changed ? "keykeeperPasswordChanged" : "keykeeperPasswordAdded", ago),
      );
    }
    return { text: parts.join(" · "), weak: score < 3 };
  });
}
