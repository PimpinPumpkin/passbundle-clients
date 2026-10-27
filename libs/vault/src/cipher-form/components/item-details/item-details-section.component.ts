// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, computed, DestroyRef, inject, input, Input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  FormBuilder,
  FormControl,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { concatMap, distinctUntilChanged, firstValueFrom, map } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { ClientType } from "@bitwarden/client-type";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { OrganizationUserType, PolicyType } from "@bitwarden/common/admin-console/enums";
import { gridOf } from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import {
  CollectionView,
  CollectionTypes,
} from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { CollectionId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  BitwardenIcon,
  CardComponent,
  ChipActionComponent,
  FormFieldModule,
  IconButtonModule,
  SectionHeaderComponent,
  SelectItemView,
  SelectModule,
  TypographyModule,
} from "@bitwarden/components";

import { getOrgIconForTier } from "../../../components/org-icon.directive";
import { Vfo1I18nPipe } from "../../../pipes/vfo1-i18n.pipe";
import { Vfo1TerminologyService } from "../../../services/vfo1-terminology.service";
import {
  CipherFormConfig,
  OptionalInitialValues,
} from "../../abstractions/cipher-form-config.service";
import { CipherFormContainer } from "../../cipher-form-container";

/**
 * Keykeeper: one choice in the web vault's Folder picker: a folder in
 * Personal (or none), or one of an organization's shared folders, under a
 * heading row for each owner.
 */
export type FolderPlaceOption = {
  value: string;
  label: string;
  icon?: BitwardenIcon;
  heading?: boolean;
  /**
   * A shared folder the person reaches but can't put this item in: they can't
   * add items there (create). Shown locked, so the picker says it's there.
   */
  locked?: boolean;
};

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "vault-item-details-section",
  templateUrl: "./item-details-section.component.html",
  imports: [
    CardComponent,
    ChipActionComponent,
    FormsModule,
    TypographyModule,
    FormFieldModule,
    ReactiveFormsModule,
    SelectModule,
    SectionHeaderComponent,
    IconButtonModule,
    JslibModule,
    CommonModule,
    Vfo1I18nPipe,
  ],
})
export class ItemDetailsSectionComponent implements OnInit {
  private vfo1TerminologyService = inject(Vfo1TerminologyService);
  protected readonly vfo1Enabled = this.vfo1TerminologyService.enabled;

  itemDetailsForm = this.formBuilder.group({
    name: ["", [Validators.required]],
    organizationId: [null],
    folderId: [null],
    collectionIds: new FormControl([], [Validators.required]),
    favorite: [false],
  });

  protected readonly showArchiveBadge = computed(() => {
    return (
      this.originalCipherView()?.isArchived &&
      this.platformUtilsService.getClientType() === ClientType.Desktop
    );
  });

  /**
   * Collection options available for the selected organization.
   * @protected
   */
  protected collectionOptions: SelectItemView[] = [];

  /**
   * Collections that are already assigned to the cipher and are read-only. These cannot be removed.
   * @protected
   */
  protected readOnlyCollections: CollectionView[] = [];

  protected showCollectionsControl: boolean;

  /** The email address associated with the active account */
  protected userEmail$ = this.accountService.activeAccount$.pipe(map((account) => account.email));

  protected organizations: Organization[] = [];

  protected userId: UserId;

  protected favoriteButtonDisabled = false;

  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input({ required: true })
  config: CipherFormConfig;

  readonly originalCipherView = input<CipherView>();

  get readOnlyCollectionsNames(): string[] {
    return this.readOnlyCollections.map((c) => c.name);
  }
  /**
   * Whether the form is in partial edit mode. Only the folder and favorite controls are available.
   */
  get partialEdit(): boolean {
    return this.config.mode === "partial-edit";
  }

  get allowPersonalOwnership() {
    return this.config.organizationDataOwnershipDisabled;
  }

  get collections(): CollectionView[] {
    return this.config.collections;
  }

  get initialValues(): OptionalInitialValues | undefined {
    return this.config.initialValues;
  }

  /**
   * Show the personal ownership option in the Owner dropdown when any of the following:
   * - personal ownership is allowed
   * - `organizationId` control is disabled
   * - personal ownership is not allowed AND the user is editing a cipher that is not
   * currently owned by an organization
   */
  get showPersonalOwnershipOption() {
    return (
      this.allowPersonalOwnership ||
      this.itemDetailsForm.controls.organizationId.disabled ||
      (!this.allowPersonalOwnership &&
        this.config.originalCipher &&
        this.itemDetailsForm.controls.organizationId.value == null)
    );
  }

  constructor(
    private cipherFormContainer: CipherFormContainer,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
    private destroyRef: DestroyRef,
    private accountService: AccountService,
    private policyService: PolicyService,
    private platformUtilsService: PlatformUtilsService,
  ) {
    this.cipherFormContainer.registerChildForm("itemDetails", this.itemDetailsForm);
    this.itemDetailsForm.valueChanges
      .pipe(
        takeUntilDestroyed(),
        // getRawValue() because organizationId can be disabled for edit mode
        map(() => this.itemDetailsForm.getRawValue()),
      )
      .subscribe((value) => {
        this.cipherFormContainer.patchCipher((cipher) => {
          Object.assign(cipher, {
            name: value.name,
            organizationId: value.organizationId,
            folderId: value.folderId,
            collectionIds: [
              ...(value.collectionIds?.map((c) => c.id) || []),
              ...this.readOnlyCollections.map((c) => c.id),
            ],
            favorite: value.favorite,
          } as CipherView);
          return cipher;
        });
      });
  }

  getOrgIcon(org: Organization): BitwardenIcon {
    return getOrgIconForTier(org.productTierType);
  }

  /**
   * Keykeeper: the web vault and the extension show one Folder picker,
   * grouped by owner, in place of Owner, Collections, and Folder: Personal
   * with its folders, then each organization with its shared folders, the
   * ones the person can't add items to locked (DESIGN.md, "Folders and
   * permissions").
   */
  protected get folderPicker(): boolean {
    const client = this.platformUtilsService.getClientType();
    return (
      (client === ClientType.Web || client === ClientType.Browser) &&
      !this.config.hideIndividualVaultFields
    );
  }

  /** The picker's value: "personal:<folder id or empty>" or "org:<org id>:<collection id>". */
  protected get place(): string {
    const value = this.itemDetailsForm.getRawValue();
    if (value.organizationId == null) {
      return `personal:${value.folderId ?? ""}`;
    }
    const first = (value.collectionIds ?? [])[0] as { id?: string } | undefined;
    return `org:${value.organizationId}:${first?.id ?? ""}`;
  }

  /**
   * The picker can't change anything: partial edits, an item whose folders
   * this person can't change, or an organization's item in a shared folder
   * they can't move it out of (share; the server refuses it too).
   */
  protected get placeLocked(): boolean {
    if (this.partialEdit) {
      return true;
    }
    if (this.itemDetailsForm.controls.organizationId.value == null) {
      return false;
    }
    if (this.itemDetailsForm.controls.collectionIds.disabled) {
      return true;
    }
    const original = this.originalCipherView();
    if (original?.id == null || original.organizationId == null) {
      return false;
    }
    const org = this.organizations.find((o) => o.id === original.organizationId);
    if (org?.canEditAllCiphers) {
      return false;
    }
    return this.collections
      .filter((c) => original.collectionIds?.includes(c.id))
      .some((c) => !gridOf(c).share);
  }

  /**
   * Keykeeper: why the picker can't change: an organization's item that this
   * person can't move to another shared folder (share in the folder it's in).
   */
  protected get placeLockedReason(): boolean {
    return (
      !this.partialEdit &&
      this.itemDetailsForm.controls.organizationId.value != null &&
      this.originalCipherView()?.id != null &&
      this.placeLocked
    );
  }

  /** The other shared folders the item is in, which the picker leaves as they are. */
  protected get alsoIn(): string[] {
    const ids = (this.itemDetailsForm.getRawValue().collectionIds ?? [])
      .slice(1)
      .map((c) => (c as { id: string }).id);
    return [...ids, ...this.readOnlyCollections.map((c) => c.id)]
      .map((id) => this.collections.find((c) => c.id === id)?.name)
      .filter((name): name is string => !!name);
  }

  protected get placeOptions(): FolderPlaceOption[] {
    const options: FolderPlaceOption[] = [];
    const orgId = this.itemDetailsForm.controls.organizationId.value as OrganizationId | null;
    const ownerLocked = this.itemDetailsForm.controls.organizationId.disabled;
    const held = new Set(this.originalCipherView()?.collectionIds ?? []);
    if (this.showPersonalOwnershipOption && (!ownerLocked || orgId == null)) {
      options.push({
        value: "heading:personal",
        label: this.i18nService.t("myVault"),
        icon: "bwi-user",
        heading: true,
      });
      for (const folder of this.config.folders ?? []) {
        options.push({
          value: `personal:${folder.id ?? ""}`,
          label: folder.name,
          icon: "bwi-folder",
        });
      }
    }
    for (const org of this.organizations) {
      if (ownerLocked && org.id !== orgId) {
        continue;
      }
      // The ones the person reaches; those they can't add items to are locked.
      const shared = this.collections.filter(
        (c) =>
          c.organizationId === org.id &&
          c.type !== CollectionTypes.DefaultUserCollection &&
          (held.has(c.id) || this.config.admin || c.assigned),
      );
      if (shared.length === 0) {
        continue;
      }
      options.push({
        value: `heading:${org.id}`,
        label: org.name,
        icon: "bwi-business",
        heading: true,
      });
      for (const c of shared.sort(Utils.getSortFunction(this.i18nService, "name"))) {
        const locked = !held.has(c.id) && !this.config.admin && !gridOf(c).create;
        options.push({
          value: `org:${org.id}:${c.id}`,
          label: c.name,
          icon: locked ? "bwi-lock" : "bwi-collection-shared",
          locked,
        });
      }
    }
    return options;
  }

  /** Puts the item where the picker says: an owner, and a folder or shared folder there. */
  protected async pickPlace(value: string) {
    // Keykeeper: never a locked shared folder, however the choice came.
    if (this.placeOptions.find((o) => o.value === value)?.locked) {
      return;
    }
    const [kind, first, second] = value.split(":");
    if (kind === "personal") {
      if (this.itemDetailsForm.controls.organizationId.value != null) {
        this.itemDetailsForm.controls.organizationId.setValue(null, { emitEvent: false });
        await this.updateCollectionOptions();
        this.setFormState();
      }
      this.itemDetailsForm.controls.folderId.setValue(first || null);
      return;
    }
    if (kind !== "org") {
      return;
    }
    const orgId = first as OrganizationId;
    const collectionId = second as CollectionId;
    if (this.itemDetailsForm.controls.organizationId.value !== orgId) {
      this.itemDetailsForm.controls.organizationId.setValue(orgId, { emitEvent: false });
      await this.updateCollectionOptions([collectionId]);
      this.setFormState();
    } else {
      this.itemDetailsForm.controls.collectionIds.setValue(
        this.collectionOptions.filter((c) => c.id === collectionId),
      );
    }
  }

  get favoriteIcon() {
    return this.itemDetailsForm.controls.favorite.value ? "bwi-star-f" : "bwi-star";
  }

  toggleFavorite() {
    this.itemDetailsForm.controls.favorite.setValue(!this.itemDetailsForm.controls.favorite.value);
  }

  get allowOwnershipChange() {
    // Do not allow ownership change in edit mode and the cipher is owned by an organization
    if (this.config.mode === "edit" && this.originalCipherView()?.organizationId != null) {
      return false;
    }

    // If personal ownership is allowed and there is at least one organization, allow ownership change.
    if (this.allowPersonalOwnership) {
      return this.organizations.length > 0;
    }

    // Personal ownership is not allowed, only allow ownership change if there is more than one organization.
    return this.organizations.length > 1;
  }

  get showOwnership() {
    // Show ownership field when editing with available orgs
    const isEditingWithOrgs = this.organizations.length > 0 && this.config.mode === "edit";

    // When in admin console, ownership should not be shown unless cloning
    const isAdminConsoleEdit = this.config.isAdminConsole && this.config.mode !== "clone";

    return this.allowOwnershipChange || (isEditingWithOrgs && !isAdminConsoleEdit);
  }

  get defaultOwner() {
    // Default to personal ownership if permitted or if there are no other alternatives
    // (in which case the top level component will show an error toast on submit)
    if (this.allowPersonalOwnership || this.organizations.length === 0) {
      return null;
    }
    return this.organizations[0].id;
  }

  async ngOnInit() {
    this.organizations = this.config.organizations.sort(
      Utils.getSortFunction(this.i18nService, "name"),
    );

    this.userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));

    const prefillCipher = this.cipherFormContainer.getInitialCipherView();

    if (prefillCipher) {
      await this.initFromExistingCipher(prefillCipher);
    } else {
      const orgId = this.initialValues?.organizationId;
      this.itemDetailsForm.setValue({
        name: this.initialValues?.name || "",
        organizationId: orgId || this.defaultOwner,
        folderId: this.initialValues?.folderId || null,
        collectionIds: [],
        favorite: false,
      });
      await this.updateCollectionOptions(this.initialValues?.collectionIds ?? []);
    }

    this.setFormState();

    this.itemDetailsForm.controls.organizationId.valueChanges
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged(),
        concatMap(async () => {
          await this.updateCollectionOptions();
          this.setFormState();
        }),
      )
      .subscribe();
  }

  /**
   * Updates the global form and organizationId control states.
   */
  private setFormState() {
    if (this.config.originalCipher && !this.allowPersonalOwnership) {
      // When editing a cipher and the user cannot have personal ownership
      // and the cipher is is not within the organization - force the user to
      // move the cipher within the organization first before editing any other field
      if (this.itemDetailsForm.controls.organizationId.value == null) {
        this.cipherFormContainer.disableFormFields();
        this.itemDetailsForm.controls.organizationId.enable();
        this.favoriteButtonDisabled = true;
      } else {
        // The "after" from the above: When editing a cipher and the user cannot have personal ownership
        // and the organization is populated - re-enable the global form.
        this.cipherFormContainer.enableFormFields();
        this.favoriteButtonDisabled = false;
        this.setCollectionControlState();
      }
    } else if (!this.allowOwnershipChange) {
      // When the user cannot change the organization field, disable the organizationId control.
      // This could be because they aren't a part of an organization
      this.itemDetailsForm.controls.organizationId.disable({ emitEvent: false });
    }
  }

  /**
   * Gets the default collection IDs for the selected organization.
   * Returns null if any of the following apply:
   * - the feature flag is disabled
   * - the "no private data policy" doesn't apply to the user
   * - no org is currently selected
   * - the selected org doesn't have the "no private data policy" enabled
   */
  private async getDefaultCollectionId(orgId?: OrganizationId) {
    if (!orgId || this.allowPersonalOwnership) {
      return;
    }

    const selectedOrgHasPolicyEnabled = (
      await firstValueFrom(
        this.policyService.policiesByType$(PolicyType.OrganizationDataOwnership, this.userId),
      )
    ).find((p) => p.organizationId);

    if (!selectedOrgHasPolicyEnabled) {
      return;
    }

    const defaultUserCollection = this.collections.find(
      (c) => c.organizationId === orgId && c.type === CollectionTypes.DefaultUserCollection,
    );
    // If the user was added after the policy was enabled as they will not have any private data
    // and will not have a default collection.
    return defaultUserCollection?.id;
  }

  private async initFromExistingCipher(prefillCipher: CipherView) {
    const { name, folderId, collectionIds } = prefillCipher;

    this.itemDetailsForm.patchValue({
      name: name ? name : (this.initialValues?.name ?? ""),
      // We do not allow changing ownership of an existing cipher.
      // Angular forms do not support `undefined` as a value for a form control,
      // force `null` if `organizationId` is undefined.
      organizationId: prefillCipher.organizationId ?? null,
      folderId: folderId ? folderId : (this.initialValues?.folderId ?? null),
      collectionIds: [],
      favorite: prefillCipher.favorite,
    });

    const orgId = this.itemDetailsForm.controls.organizationId.value as OrganizationId;
    const initializedWithCachedCipher = this.cipherFormContainer.initializedWithCachedCipher();

    // Configure form for clone mode.
    if (this.config.mode === "clone") {
      if (!initializedWithCachedCipher) {
        this.itemDetailsForm.controls.name.setValue(
          prefillCipher.name + " - " + this.i18nService.t("clone"),
        );
      }

      if (!this.allowPersonalOwnership && prefillCipher.organizationId == null) {
        this.itemDetailsForm.controls.organizationId.setValue(this.defaultOwner);
      }
    }

    const prefillCollections = collectionIds?.length
      ? (collectionIds as CollectionId[])
      : (this.initialValues?.collectionIds ?? []);

    await this.updateCollectionOptions(prefillCollections);

    this.setCollectionControlState();

    if (this.partialEdit) {
      this.itemDetailsForm.disable();
      this.itemDetailsForm.controls.favorite.enable();
      this.itemDetailsForm.controls.folderId.enable();
    } else if (this.config.mode === "edit") {
      if (!this.config.isAdminConsole || !this.config.admin) {
        this.readOnlyCollections = this.collections.filter(
          // When the configuration is set up for admins, they can alter read only collections
          (c) =>
            c.organizationId === orgId &&
            c.readOnly &&
            this.originalCipherView().collectionIds.includes(c.id as CollectionId),
        );
      }
    }
  }

  private setCollectionControlState() {
    const initialCipherView = this.cipherFormContainer.getInitialCipherView();
    // These permission checks are only meaningful for existing, server-fetched ciphers whose
    // edit/viewPassword flags reflect real server-side permissions. Skip for new ciphers (no id).
    if (!initialCipherView?.id) {
      return;
    }
    const orgId = this.itemDetailsForm.controls.organizationId.value as OrganizationId;
    const organization = this.organizations.find((o) => o.id === orgId);
    if (!organization) {
      return;
    }
    // Disable the collection control if either of the following apply:
    // 1. The organization does not allow editing all ciphers and the existing cipher cannot be assigned to
    // collections
    // 2. When Owners/Admins access setting is turned on.
    // AND either:
    //   a. Disable Collections Options if Owner/Admin does not have Edit/Manage permissions on item
    //   b. Disable Collections Options if Custom user does not have Edit/Manage permissions on item
    if (
      (!organization.canEditAllCiphers && !initialCipherView.canAssignToCollections) ||
      (organization.allowAdminAccessToAllCollectionItems &&
        (!initialCipherView.viewPassword || !initialCipherView.edit)) ||
      (organization.type === OrganizationUserType.Custom && !initialCipherView.viewPassword)
    ) {
      this.itemDetailsForm.controls.collectionIds.disable();
    }
  }

  /**
   * Updates the collection options based on the selected organization.
   * @param startingSelection - Optional starting selection of collectionIds to be automatically selected.
   * @private
   */
  private async updateCollectionOptions(startingSelection: CollectionId[] = []) {
    const orgId = this.itemDetailsForm.controls.organizationId.value as OrganizationId;
    const collectionsControl = this.itemDetailsForm.controls.collectionIds;

    // No organization selected, disable/hide the collections control.
    if (orgId == null) {
      this.collectionOptions = [];
      collectionsControl.reset();
      collectionsControl.disable();
      this.showCollectionsControl = false;
      return;
    } else {
      collectionsControl.enable();
      this.showCollectionsControl = true;
    }

    /**
     * Determine if the the cipher is only assigned to shared collections.
     * i.e. The cipher is not assigned to a default collections.
     * Note: `.every` will return true for an empty array
     */
    const cipherIsOnlyInOrgCollections =
      (this.originalCipherView()?.collectionIds ?? []).length > 0 &&
      this.originalCipherView().collectionIds.every(
        (cId) =>
          this.collections.find((c) => c.id === cId)?.type === CollectionTypes.SharedCollection,
      );
    this.collectionOptions = this.collections
      .filter((c) => {
        // The collection belongs to the organization
        if (c.organizationId !== orgId) {
          return false;
        }

        // When in partial edit mode, show all org collections because the control is disabled.
        if (this.partialEdit) {
          return true;
        }

        // When viewing as an admin, all collections should be shown, even readonly. (AC Only)
        if (this.config.admin) {
          return true;
        }

        // When the cipher is only assigned to shared collections, do not allow a user to
        // move it back to a default collection. Exclude the default collection from the list.
        if (cipherIsOnlyInOrgCollections && c.type === CollectionTypes.DefaultUserCollection) {
          return false;
        }

        // Non-admins can only select assigned collections that are not read only. (Non-AC)
        // Keykeeper: the ones they can add items to (create).
        return c.assigned && gridOf(c).create;
      })
      .sort((a, b) => {
        // Show default collection first
        const aIsDefaultCollection = a.type === CollectionTypes.DefaultUserCollection ? -1 : 0;
        const bIsDefaultCollection = b.type === CollectionTypes.DefaultUserCollection ? -1 : 0;
        return aIsDefaultCollection - bIsDefaultCollection;
      })
      .map((c) => ({
        id: c.id,
        name: c.name,
        listName: c.name,
        labelName: c.name,
      }));

    collectionsControl.reset();
    collectionsControl.enable();
    this.showCollectionsControl = true;

    // If there is only one collection, select it by default.
    if (this.collectionOptions.length === 1) {
      collectionsControl.setValue(this.collectionOptions);
      return;
    }

    if (startingSelection?.filter(Boolean).length > 0) {
      collectionsControl.setValue(
        this.collectionOptions.filter((c) => startingSelection.includes(c.id as CollectionId)),
      );
    } else {
      const defaultCollectionId = await this.getDefaultCollectionId(orgId);
      if (defaultCollectionId) {
        collectionsControl.setValue(
          this.collectionOptions.filter((c) => c.id === defaultCollectionId),
        );
      }
    }
  }
}
