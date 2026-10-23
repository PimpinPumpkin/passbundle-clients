import { Injectable, signal } from "@angular/core";

/**
 * Keykeeper: the name of what's picked in the web vault's left menu, which
 * the vault page shows as its title, so the two always agree. The menu sets
 * it; it's undefined when nothing in the menu is showing. See DESIGN.md,
 * "The left menu".
 */
@Injectable({ providedIn: "root" })
export class KeykeeperPickedLabelService {
  readonly label = signal<string | undefined>(undefined);
}
