import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";
import { FormControl } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { debounceTime, distinctUntilChanged, filter, map, switchMap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { getById } from "@bitwarden/common/platform/misc";
import { SearchModule } from "@bitwarden/components";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

import {
  AccessLevel,
  AccessMemberInput,
  AccessPath,
  AccessRole,
  folderCount,
  folderMatches,
  howText,
  itemCount,
  LEVEL_KEYS,
  MemberAccess,
  memberMatches,
  reachOf,
} from "./access-review";
import { KeykeeperAccessReviewService, LoadedAccess } from "./access-review.service";

const ROLE_KEYS: Record<AccessRole, string> = {
  owner: "owner",
  admin: "admin",
  user: "user",
  custom: "custom",
};

/**
 * Keykeeper: an organization's Access page, next to Members. Who can open
 * each shared folder (upstream's collections), how (directly or through which
 * group), and with what permission, by person or by folder. Owners and admins
 * see every folder; custom roles that manage members see the folders they open
 * themselves. See DESIGN.md, "Access and offboarding".
 */
@Component({
  selector: "app-keykeeper-access",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule, SearchModule],
  templateUrl: "access.component.html",
})
export class KeykeeperAccessComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly organizationService = inject(OrganizationService);
  private readonly accountService = inject(AccountService);
  private readonly accessReview = inject(KeykeeperAccessReviewService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);

  protected readonly searchControl = new FormControl("", { nonNullable: true });
  protected readonly view = signal<"people" | "folders">("people");
  protected readonly loaded = signal<LoadedAccess | null>(null);
  protected readonly failed = signal(false);
  /** People whose item counts are showing, by membership id. */
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  private readonly query = toSignal(this.searchControl.valueChanges.pipe(debounceTime(150)), {
    initialValue: "",
  });

  protected readonly people = computed(() =>
    (this.loaded()?.review.members ?? []).filter((m) => memberMatches(m, this.query())),
  );
  protected readonly folders = computed(() =>
    (this.loaded()?.review.folders ?? []).filter((f) => folderMatches(f, this.query())),
  );

  protected readonly t = (key: string, ...args: string[]) => this.i18nService.t(key, ...args);

  constructor() {
    this.route.params
      .pipe(
        map((params) => params.organizationId as string),
        switchMap((orgId) =>
          this.accountService.activeAccount$.pipe(
            getUserId,
            switchMap((userId) => this.organizationService.organizations$(userId)),
            getById(orgId),
          ),
        ),
        filter((org): org is Organization => org != null),
        // Only when the organization changes, not on every refresh of the list.
        distinctUntilChanged((a, b) => a.id === b.id),
        takeUntilDestroyed(),
      )
      .subscribe((org) => void this.load(org));
  }

  private async load(org: Organization) {
    this.loaded.set(null);
    this.failed.set(false);
    try {
      this.loaded.set(await this.accessReview.load(org));
    } catch (e) {
      this.logService.error(e);
      this.failed.set(true);
    }
  }

  protected toggle(memberId: string) {
    const next = new Set(this.expanded());
    if (!next.delete(memberId)) {
      next.add(memberId);
    }
    this.expanded.set(next);
  }

  protected isExpanded(memberId: string): boolean {
    return this.expanded().has(memberId);
  }

  protected displayName(member: AccessMemberInput): string {
    return member.name || member.email;
  }

  protected roleLabel(member: AccessMemberInput): string {
    return this.t(ROLE_KEYS[member.role]);
  }

  protected levelLabel(level: AccessLevel): string {
    return this.t(LEVEL_KEYS[level]);
  }

  protected how(paths: AccessPath[]): string {
    return howText(paths, this.t);
  }

  protected items(n: number): string {
    return itemCount(n, this.t);
  }

  /** "3 shared folders, 42 items" for someone whose counts are showing. */
  protected total(access: MemberAccess): string {
    const review = this.loaded()!.review;
    const reach = reachOf(access, review);
    return `${folderCount(reach.folders, this.t)}, ${itemCount(reach.items, this.t)}`;
  }

  protected everyItemPeople(people: AccessMemberInput[]): string {
    return people.map((m) => `${this.displayName(m)} (${this.roleLabel(m)})`).join(", ");
  }

  protected hiddenFolders(): string | null {
    const n = this.loaded()?.hiddenFolders ?? 0;
    if (n === 0) {
      return null;
    }
    return n === 1
      ? this.t("keykeeperAccessHiddenFolder")
      : this.t("keykeeperAccessHiddenFolders", String(n));
  }
}
