import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

/**
 * Keykeeper: keeps an item's "Expires" and its template's expiration date
 * field the same while the editor is open (DESIGN.md, "Expiration dates").
 * The two are in different sections of the form, so each says here when the
 * person changes it, and the other follows. Each side ignores a date it
 * already has, so a change goes across once. Dates are "YYYY-MM-DD", or ""
 * for none.
 */
@Injectable()
export class KeykeeperExpiresLink {
  private readonly field = new Subject<string>();
  private readonly expires = new Subject<string>();

  /** The template's expiration date field changed. */
  readonly fromField$ = this.field.asObservable();
  /** "Expires" changed. */
  readonly fromExpires$ = this.expires.asObservable();

  fieldChanged(date: string) {
    this.field.next(date);
  }

  expiresChanged(date: string) {
    this.expires.next(date);
  }
}
