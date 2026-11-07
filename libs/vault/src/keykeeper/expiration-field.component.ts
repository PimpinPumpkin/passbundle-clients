import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { CipherType } from "@bitwarden/common/vault/enums";
import { FormFieldModule, SelectModule } from "@bitwarden/components";

import { CipherFormContainer } from "../cipher-form/cipher-form-container";

import {
  parseRemindDays,
  remindValue,
  setStoredExpiration,
  setStoredRemind,
  storedExpiration,
  storedRemind,
} from "./expiration";

/** "30, 7, and 1 day before"; "60 and 14 days before". */
export function remindLabel(days: number[]): string {
  const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
    days.map(String),
  );
  return `${list} ${days[days.length - 1] === 1 ? "day" : "days"} before`;
}

/** What "Remind me" offers; "" is the default, which isn't stored. */
export const REMIND_CHOICES: { value: string; label: string }[] = [
  { value: "", label: remindLabel([30, 7, 1]) },
  { value: "90,30,7,1", label: remindLabel([90, 30, 7, 1]) },
  { value: "7,1", label: remindLabel([7, 1]) },
  { value: "none", label: "Don't remind me" },
];

/**
 * Keykeeper: the "Expires" date in the item editor, and "Remind me", the days
 * before it to remind on (DESIGN.md, "Reminder days, per item"). Cards use
 * their own expiry month, so they get only "Remind me". Only
 * `keykeeper.expires` and `keykeeper.remind` are touched.
 */
@Component({
  selector: "vault-keykeeper-expiration-field",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormFieldModule, SelectModule],
  template: `
    <ng-container [formGroup]="form">
      @if (!isCard) {
        <bit-form-field>
          <bit-label>Expires</bit-label>
          <input bitInput type="date" formControlName="expires" data-testid="keykeeper-expires" />
          <bit-hint>Leave empty if it never expires.</bit-hint>
        </bit-form-field>
      }
      @if (isCard || form.value.expires) {
        <bit-form-field>
          <bit-label>Remind me</bit-label>
          <bit-select formControlName="remind" data-testid="keykeeper-remind">
            @for (choice of choices(); track choice.value) {
              <bit-option [value]="choice.value" [label]="choice.label"></bit-option>
            }
          </bit-select>
          <bit-hint
            >In the browser extension and the desktop and phone apps, while unlocked. A reminder
            never names the item.</bit-hint
          >
        </bit-form-field>
      }
    </ng-container>
  `,
})
export class KeykeeperExpirationFieldComponent implements OnInit {
  protected readonly form = this.formBuilder.group({ expires: [""], remind: [""] });
  protected readonly choices = signal(REMIND_CHOICES);

  constructor(
    private readonly cipherFormContainer: CipherFormContainer,
    private readonly formBuilder: FormBuilder,
  ) {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(({ expires, remind }) => {
      this.cipherFormContainer.patchCipher((cipher) => {
        if (!this.isCard) {
          setStoredExpiration(cipher, expires || null);
        }
        // Without a date there's nothing to remind about, so the days go too.
        setStoredRemind(cipher, this.isCard || expires ? remind || null : null);
        return cipher;
      });
    });
  }

  protected get isCard(): boolean {
    return this.cipherFormContainer.config.cipherType === CipherType.Card;
  }

  ngOnInit() {
    const initial = this.cipherFormContainer.getInitialCipherView() ?? {};
    const remind = storedRemind(initial) ?? "";
    // Days another app stored that "Remind me" doesn't offer stay, as they are.
    if (!REMIND_CHOICES.some((c) => c.value === remind)) {
      const days = parseRemindDays(remind);
      if (Array.isArray(days)) {
        this.choices.set([
          ...REMIND_CHOICES,
          { value: remindValue(days)!, label: remindLabel(days) },
        ]);
      }
    }
    this.form.patchValue(
      { expires: storedExpiration(initial) ?? "", remind },
      { emitEvent: false },
    );
    if (this.cipherFormContainer.config.mode === "partial-edit") {
      this.form.disable({ emitEvent: false });
    }
  }
}
