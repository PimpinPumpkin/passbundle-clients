import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { FormBuilder, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import {
  INSTALL_COMMAND_REFUSED,
  InstallCommandParts,
  installCommand,
} from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { PwnedPasswordsCancelledError } from "@bitwarden/common/dirt/keykeeper/pwned-passwords";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import {
  expirationBadgeVariant,
  expirationLabel,
} from "@bitwarden/common/vault/keykeeper/expiration";
import { DialogService, ToastService } from "@bitwarden/components";
import { templateDefinition } from "@bitwarden/vault";

import {
  BasePolicyEditDefinition,
  ossPolicyEditRegister,
} from "../../admin-console/organizations/policies";
import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";
import { KeykeeperEventStreamingComponent } from "../event-streaming/event-streaming.component";
import { KeykeeperBreachCheckSetting } from "../health/breach-check-setting.service";
import { KeykeeperExposureChecks } from "../health/exposure-checks.service";
import { KeykeeperJoinSealer } from "../joining/join-sealer.service";
import {
  clientRemovedLine,
  removedByClientLine,
  replaceTokenPrompt,
} from "../offboarding/offboarding";

import {
  ClientHealth,
  clientHealth,
  clientItemsToCheck,
  ExpiringItem,
  expiringItems,
  ItemToFix,
  StrengthScorer,
} from "./client-health";
import { KeykeeperDefaultPoliciesComponent } from "./default-policies.component";
import { describeEvent, MspEvent } from "./msp-activity";
import {
  ClientEnrollment,
  ClientPreset,
  InvitationInfo,
  KeykeeperMspApiService,
  MspClient,
  MspInvite,
  MspDetails,
  MspPolicies,
  MspRole,
  MspTemplates,
  MspStaffMember,
  TechnicianAccess,
} from "./msp-api.service";
import { KeykeeperMspJoiningComponent } from "./msp-joining.component";
import { clientPolicySummary } from "./msp-policies";
import { KeykeeperMspSiteFixesComponent } from "./msp-site-fixes.component";
import { KeykeeperMspTemplatesComponent } from "./msp-templates.component";
import { KeykeeperMspWorkService } from "./msp-work.service";
import { DEFAULT_ACCESS, describeAccess, reachesEveryClient } from "./technician-access";
import { KeykeeperTechnicianAccessEditorComponent } from "./technician-access-editor.component";

const CONFIRMED = 2;
const EVENTS_PER_PAGE = 50;

/**
 * Plan features every client on our server has, for upstream's checks of
 * which policies to show. Which policies the server supports comes from the
 * server.
 */
const CLIENT_FEATURES = {
  useResetPassword: true,
  useSso: false,
  useAutomaticUserConfirmation: false,
} as Organization;

/**
 * Keykeeper: the MSP console. Every client at a glance, with a way into each
 * client's admin console, plus the MSP's staff and what each technician can
 * reach. Opening it confirms anyone waiting for an org key that the signed-in
 * person can give.
 */
@Component({
  selector: "app-keykeeper-msp",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedModule,
    HeaderModule,
    KeykeeperDefaultPoliciesComponent,
    KeykeeperMspJoiningComponent,
    KeykeeperEventStreamingComponent,
    KeykeeperMspSiteFixesComponent,
    KeykeeperMspTemplatesComponent,
    KeykeeperTechnicianAccessEditorComponent,
  ],
  template: `
    <app-header></app-header>
    <bit-container>
      @if (invitation(); as inv) {
        <bit-callout type="info" title="You're invited" data-testid="msp-invitation">
          @if (inv.info.forYou) {
            <p>
              {{ inv.info.invitedBy }} invited you to join {{ inv.info.mspName }} as
              {{ inv.info.role === "admin" ? "an admin" : "a technician" }}. You'll get access to
              the clients {{ inv.info.mspName }} manages.
            </p>
            <button
              bitButton
              buttonType="primary"
              type="button"
              (click)="acceptInvitation(inv.token)"
            >
              Join {{ inv.info.mspName }}
            </button>
          } @else {
            <p class="tw-mb-0">
              This invitation is for {{ inv.info.email }}. Sign in with that account to accept it.
            </p>
          }
        </bit-callout>
      }
      @if (loading()) {
        <bit-icon name="bwi-spinner" class="bwi-spin tw-text-muted" title="Loading"></bit-icon>
      } @else if (msp(); as m) {
        <p class="tw-mb-6" data-testid="msp-name">
          <span bitTypography="h2" class="tw-mr-2">{{ m.name }}</span>
          <span bitBadge variant="secondary">{{
            m.role === "admin" ? "Admin" : "Technician"
          }}</span>
        </p>

        <section class="tw-mb-8" aria-label="Clients">
          <h2 bitTypography="h3">Clients</h2>
          @if (exposedCheck(); as check) {
            @if (check.state === "checking") {
              <p
                bitTypography="helper"
                class="tw-mb-2"
                role="status"
                data-testid="msp-exposed-progress"
              >
                <bit-icon name="bwi-spinner" class="bwi-spin tw-mr-1" />
                Checking passwords against known breaches: {{ check.checked }} of {{ check.total }}
              </p>
            } @else if (check.state === "off") {
              <div class="tw-mb-3 tw-flex tw-items-center tw-gap-3" data-testid="msp-exposed-off">
                <button
                  bitButton
                  buttonType="secondary"
                  type="button"
                  class="tw-shrink-0 tw-whitespace-nowrap"
                  (click)="checkByHand(m)"
                >
                  Check exposed passwords
                </button>
                <span bitTypography="helper">
                  Your settings don't check passwords against known breaches after unlocking.
                  Checking sends only the first 5 characters of each password's SHA-1 hash.
                </span>
              </div>
            } @else if (check.unchecked > 0) {
              <bit-callout
                type="warning"
                title="Couldn't check for exposed passwords"
                data-testid="msp-exposed-unchecked"
              >
                <p>
                  {{ itemCount(check.unchecked) }}
                  couldn't be checked against known breaches: this browser couldn't reach
                  api.pwnedpasswords.com. It may be offline, or a firewall may block it. Weak and
                  reused counts don't need it and are up to date.
                </p>
                <button bitButton buttonType="secondary" type="button" (click)="checkAgain(m)">
                  Try again
                </button>
              </bit-callout>
            }
          }
          @if (m.clients.length === 0) {
            <p bitTypography="body1">No clients yet.</p>
          } @else {
            <bit-table>
              <ng-container header>
                <tr>
                  <th bitCell>Client</th>
                  <th bitCell title="Default policies, or how many policies are the client's own">
                    Policies
                  </th>
                  <th bitCell>Members</th>
                  <th bitCell>Waiting</th>
                  <th bitCell>Invited</th>
                  <th bitCell title="Expired, or expiring within 30 days">Expiring</th>
                  <th bitCell title="Passwords with a strength of 2 or less out of 4">Weak</th>
                  <th bitCell title="Passwords used by more than one login">Reused</th>
                  <th bitCell [title]="exposedTitle">Exposed</th>
                  <th bitCell></th>
                </tr>
              </ng-container>
              <ng-template body>
                @for (client of m.clients; track client.id) {
                  <tr bitRow [attr.data-testid]="'msp-client-' + client.name">
                    <td bitCell>
                      {{ client.name }}
                      @if (client.provisioning; as p) {
                        <div class="tw-text-xs tw-text-muted" data-testid="msp-client-provisioning">
                          Microsoft Entra ID:
                          {{
                            p.lastUsedAt
                              ? "synced " + (p.lastUsedAt | date: "short")
                              : "not synced yet"
                          }}
                        </div>
                      }
                      <!-- Keykeeper: people the client took out itself, who stay out (DESIGN.md, "Offboarding"). -->
                      @if (clientRemovedLine(client); as removed) {
                        <div class="tw-text-xs tw-text-muted" data-testid="msp-client-removed">
                          {{ removed }}
                        </div>
                      }
                      @if (m.role === "admin" && client.removedSinceToken) {
                        <div class="tw-text-xs" data-testid="msp-client-replace-token">
                          <button
                            type="button"
                            bitLink
                            class="tw-text-start"
                            (click)="toggleInstall(client)"
                          >
                            {{
                              client.removedSinceToken === 1
                                ? "1 person was"
                                : client.removedSinceToken + " people were"
                            }}
                            removed since its install command was made: replace its token
                          </button>
                        </div>
                      }
                    </td>
                    <td bitCell data-testid="msp-client-policies">{{ policySummary(client) }}</td>
                    <td bitCell data-testid="msp-client-members">{{ client.members.confirmed }}</td>
                    <td bitCell data-testid="msp-client-waiting">{{ client.members.accepted }}</td>
                    <td bitCell>{{ client.members.invited }}</td>
                    @let clientHealth = healthOf(client);
                    <td bitCell data-testid="msp-client-expiring">{{ clientHealth.expiring }}</td>
                    <!-- A count with something to fix opens the client's list of what to fix. -->
                    <td bitCell data-testid="msp-client-weak">
                      <ng-container
                        *ngTemplateOutlet="
                          healthCount;
                          context: { client: client, value: clientHealth.weak, what: 'weak' }
                        "
                      />
                    </td>
                    <td bitCell data-testid="msp-client-reused">
                      <ng-container
                        *ngTemplateOutlet="
                          healthCount;
                          context: { client: client, value: clientHealth.reused, what: 'reused' }
                        "
                      />
                    </td>
                    <td
                      bitCell
                      data-testid="msp-client-exposed"
                      [attr.title]="clientHealth.exposedNote"
                    >
                      <ng-container
                        *ngTemplateOutlet="
                          healthCount;
                          context: { client: client, value: clientHealth.exposed, what: 'exposed' }
                        "
                      />
                    </td>
                    <td bitCell>
                      <!-- The actions wrap, each kept whole, so the table fits beside the health columns. -->
                      <div
                        class="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-x-4 tw-gap-y-1"
                      >
                        @if (m.role === "admin" || m.access?.installCommands !== false) {
                          <button
                            type="button"
                            bitLink
                            class="tw-whitespace-nowrap"
                            [attr.aria-expanded]="installFor()?.client.id === client.id"
                            (click)="toggleInstall(client)"
                          >
                            Install command
                          </button>
                        }
                        @if (client.you?.status === CONFIRMED && m.role === "admin") {
                          <a
                            bitLink
                            class="tw-whitespace-nowrap"
                            [routerLink]="['/organizations', client.id, 'settings', 'provisioning']"
                            [attr.aria-label]="'Provisioning for ' + client.name"
                          >
                            Provisioning
                          </a>
                        }
                        @if (unconfirmedClient(client)) {
                          <button
                            type="button"
                            bitLink
                            class="tw-whitespace-nowrap"
                            data-testid="msp-client-confirm"
                            [attr.aria-label]="'Confirm ' + client.name + ' is your client'"
                            (click)="confirmClient(client)"
                          >
                            Confirm client
                          </button>
                        }
                        @if (client.you?.status === CONFIRMED) {
                          <a bitLink [routerLink]="openLink(client)">Open</a>
                        } @else if ((client.you?.status ?? 0) < 0) {
                          <span
                            class="tw-whitespace-nowrap tw-text-muted"
                            data-testid="msp-client-revoked"
                            >Revoked by the client</span
                          >
                        } @else {
                          <span class="tw-whitespace-nowrap tw-text-muted">Waiting for access</span>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </ng-template>
            </bit-table>
            <ng-template #healthCount let-client="client" let-value="value" let-what="what">
              @if (opensDetails(client, value)) {
                <button
                  type="button"
                  bitLink
                  class="tw-text-start"
                  [attr.aria-expanded]="detailsFor()?.id === client.id"
                  [attr.aria-label]="
                    'Show the ' + what + ' passwords in ' + client.name + ': ' + value
                  "
                  (click)="toggleDetails(client)"
                >
                  {{ value }}
                </button>
              } @else {
                {{ value }}
              }
            </ng-template>
          }
          @if (installFor(); as install) {
            <section
              class="tw-mt-4 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
              aria-label="Install command"
              data-testid="msp-install"
            >
              <h3 bitTypography="h5">Install command for {{ install.client.name }}</h3>
              @if (replaceTokenPrompt(install.enrollment.removedSinceToken); as prompt) {
                <bit-callout
                  type="warning"
                  title="Replace the token?"
                  data-testid="msp-install-replace-prompt"
                >
                  {{ prompt }}
                </bit-callout>
              }
              @if (install.enrollment.token; as token) {
                <p bitTypography="body2">
                  Run this from your RMM on {{ install.client.name }}'s computers, as an
                  administrator. It installs the extension in Edge and Chrome, turns off the
                  browsers' password managers, and anyone who then signs in joins
                  {{ install.client.name }}.
                </p>
                @if (installCommand(token); as command) {
                  <pre
                    class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
                    data-testid="msp-install-command"
                    >{{ command }}</pre>
                } @else {
                  <p
                    bitTypography="body2"
                    class="tw-text-danger"
                    data-testid="msp-install-command-refused"
                  >
                    {{ refusedCommand }}
                  </p>
                }
                <p bitTypography="helper">
                  {{
                    install.enrollment.joins === 1
                      ? "1 person has"
                      : install.enrollment.joins + " people have"
                  }}
                  joined with this command.
                  @if (install.enrollment.domains.length) {
                    Only {{ domainList(install.enrollment.domains) }} accounts with a verified email
                    can join with it.
                  } @else {
                    Anyone who has it can ask to join, and an owner or admin approves each one, so
                    treat it like a password.
                  }
                </p>
                @if (m.role === "admin") {
                  <form
                    [formGroup]="domainsForm"
                    [bitSubmit]="saveDomains"
                    class="tw-mb-3"
                    data-testid="msp-install-domains"
                  >
                    <bit-form-field>
                      <bit-label>Only these email domains can join</bit-label>
                      <input bitInput formControlName="domains" placeholder="example.com" />
                      <bit-hint>
                        Separate domains with spaces or commas. Leave it empty to let anyone with
                        the command join. People you invite by email can join from any address.
                      </bit-hint>
                    </bit-form-field>
                    <button bitButton bitFormButton buttonType="secondary" type="submit">
                      Save domains
                    </button>
                  </form>
                }
                <div class="tw-flex tw-gap-2">
                  <button
                    bitButton
                    buttonType="secondary"
                    type="button"
                    (click)="copyCommand(token)"
                  >
                    Copy command
                  </button>
                  @if (m.role === "admin") {
                    <button
                      bitButton
                      buttonType="danger"
                      type="button"
                      (click)="replaceToken(install.client)"
                    >
                      Replace token
                    </button>
                  }
                </div>
              } @else if (m.role === "admin") {
                <button
                  bitButton
                  buttonType="primary"
                  type="button"
                  (click)="replaceToken(install.client)"
                >
                  Create install command
                </button>
              } @else {
                <p bitTypography="body2">
                  Ask an MSP admin to create this client's install command.
                </p>
              }
            </section>
          }
          @if (detailsFor(); as client) {
            @let details = health()?.get(client.id);
            <section
              class="tw-mt-4 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
              aria-label="Password health"
              data-testid="msp-health-details"
            >
              <h3 bitTypography="h5">Passwords to fix in {{ client.name }}</h3>
              <p bitTypography="body2">
                Weak, reused, and exposed passwords in {{ client.name }}'s items that you can open.
                Exposed passwords are in known data breaches. Checking never sends a password: only
                the first 5 characters of each password's SHA-1 hash leave this browser, and the
                match is made here.
              </p>
              @if (details?.unchecked && details!.toFix.length > 0) {
                <p bitTypography="body2" data-testid="msp-health-unchecked">
                  {{ itemCount(details!.unchecked) }} couldn't be checked for breaches.
                </p>
              }
              @if (details == null) {
                <bit-icon name="bwi-spinner" class="bwi-spin tw-text-muted" title="Loading" />
              } @else if (details.toFix.length === 0) {
                <p bitTypography="body2" class="tw-mb-0" data-testid="msp-health-nothing">
                  @if (details.exposed === undefined && exposedCheck()?.state === "off") {
                    Nothing weak or reused. Exposed passwords aren't checked yet.
                  } @else if (details.exposed === undefined) {
                    Nothing weak or reused so far. Still checking for exposed passwords.
                  } @else if (details.unchecked > 0) {
                    Nothing weak or reused; {{ itemCount(details.unchecked) }} couldn't be checked
                    for breaches.
                  } @else {
                    Nothing to fix.
                  }
                </p>
              } @else {
                <bit-table>
                  <ng-container header>
                    <tr>
                      <th bitCell>Item</th>
                      <th bitCell>What's wrong</th>
                      <th bitCell></th>
                    </tr>
                  </ng-container>
                  <ng-template body>
                    @for (item of details.toFix; track item.id) {
                      <tr bitRow [attr.data-testid]="'msp-health-item-' + item.name">
                        <td bitCell>{{ item.name }}</td>
                        <td bitCell class="tw-space-x-1">
                          @if (item.exposed) {
                            <span bitBadge variant="danger">{{ exposedLabel(item) }}</span>
                          } @else if (item.exposed === null) {
                            <span bitBadge variant="secondary">Couldn't check for breaches</span>
                          }
                          @if (item.weak) {
                            <span bitBadge variant="warning">Weak</span>
                          }
                          @if (item.reused) {
                            <span bitBadge variant="warning">Reused</span>
                          }
                        </td>
                        <td bitCell class="tw-text-right">
                          <a
                            bitLink
                            [routerLink]="itemLink(client, item).path"
                            [queryParams]="itemLink(client, item).query"
                            [attr.aria-label]="'Open ' + item.name"
                            >Open</a
                          >
                        </td>
                      </tr>
                    }
                  </ng-template>
                </bit-table>
              }
            </section>
          }
          @if (m.role === "admin") {
            <form
              [formGroup]="clientForm"
              [bitSubmit]="addClient"
              class="tw-mt-4 tw-flex tw-items-end tw-gap-2"
            >
              <bit-form-field disableMargin class="tw-grow">
                <bit-label>New client's name</bit-label>
                <input bitInput formControlName="name" />
              </bit-form-field>
              <!-- Wide enough for "Default policies (recommended)" beside its arrow. -->
              <bit-form-field disableMargin class="tw-min-w-64">
                <bit-label>Policies</bit-label>
                <select bitInput formControlName="preset">
                  <option value="business">Default policies (recommended)</option>
                  <option value="none">None</option>
                </select>
              </bit-form-field>
              <button bitButton bitFormButton buttonType="primary" type="submit">Add client</button>
            </form>
          }
        </section>

        @if (expiring(); as soon) {
          @if (soon.length > 0) {
            <section class="tw-mb-8" aria-label="Expiring soon" data-testid="msp-expiring">
              <h2 bitTypography="h3">Expiring soon</h2>
              <p bitTypography="body2">
                Items in your clients' organizations that have expired or expire within 30 days,
                soonest first.
              </p>
              <bit-table>
                <ng-container header>
                  <tr>
                    <th bitCell>Item</th>
                    <th bitCell>Client</th>
                    <th bitCell>Expires</th>
                  </tr>
                </ng-container>
                <ng-template body>
                  @for (item of soon; track item.id) {
                    <tr bitRow [attr.data-testid]="'msp-expiring-' + item.name">
                      <td bitCell>
                        <a
                          bitLink
                          [routerLink]="['/organizations', item.organizationId, 'vault']"
                          [queryParams]="{ itemId: item.id, action: 'view' }"
                          >{{ item.name }}</a
                        >
                      </td>
                      <td bitCell>{{ item.client }}</td>
                      <td bitCell>
                        <span bitBadge [variant]="badgeVariant(item)">{{ badgeLabel(item) }}</span>
                        <span class="tw-ml-2 tw-text-muted">{{
                          item.expires | date: "mediumDate"
                        }}</span>
                      </td>
                    </tr>
                  }
                </ng-template>
              </bit-table>
            </section>
          }
        }

        @if (policies(); as p) {
          <app-keykeeper-default-policies
            [mspId]="m.id"
            [isAdmin]="m.role === 'admin'"
            [policies]="p"
            [definitions]="policyDefinitions()"
            [organizationId]="keyedClientId()"
            (changed)="reload(m.id)"
          />
        }

        @if (templates(); as t) {
          <app-keykeeper-msp-templates [msp]="m" [templates]="t" (changed)="reload(m.id)" />
        }

        <app-keykeeper-msp-joining
          [mspId]="m.id"
          [isAdmin]="m.role === 'admin'"
          (changed)="reload(m.id)"
        />

        @if (m.role === "admin") {
          <app-keykeeper-msp-site-fixes [mspId]="m.id" />
          <div class="tw-mt-8">
            <app-keykeeper-event-streaming
              [scope]="{ kind: 'msp', id: m.id }"
              [heading]="true"
              (changed)="reload(m.id)"
            />
          </div>
        }

        <section aria-label="Staff">
          <h2 bitTypography="h3">Staff</h2>
          <bit-table>
            <ng-container header>
              <tr>
                <th bitCell>Name</th>
                <th bitCell>Role</th>
                <th bitCell>Access</th>
                <th bitCell></th>
              </tr>
            </ng-container>
            <ng-template body>
              @for (person of m.staff; track person.userId) {
                <tr bitRow [attr.data-testid]="'msp-staff-' + person.email">
                  <td bitCell>
                    <div>{{ person.name || person.email }}</div>
                    <div class="tw-text-sm tw-text-muted">{{ person.email }}</div>
                    @if (removedByClientLine(person, m.clients); as removed) {
                      <div class="tw-text-sm tw-text-muted" data-testid="msp-staff-removed">
                        {{ removed }}
                      </div>
                    }
                  </td>
                  <td bitCell>
                    @if (m.role === "admin") {
                      <select
                        bitInput
                        class="tw-min-w-36"
                        [attr.aria-label]="'Role for ' + person.email"
                        [value]="person.role"
                        (change)="changeRole(person, $any($event.target).value)"
                      >
                        <option value="admin">Admin</option>
                        <option value="technician">Technician</option>
                      </select>
                    } @else {
                      {{ person.role === "admin" ? "Admin" : "Technician" }}
                    }
                  </td>
                  <td bitCell data-testid="msp-staff-access">
                    @if (person.role === "admin") {
                      <span class="tw-text-muted">Owner of every client</span>
                    } @else if (person.access; as access) {
                      {{ accessText(access) }}
                    }
                  </td>
                  <td bitCell class="tw-whitespace-nowrap tw-text-right">
                    @if (m.role === "admin") {
                      @if (person.role === "technician") {
                        <button
                          type="button"
                          bitLink
                          class="tw-mr-2"
                          [attr.aria-expanded]="accessFor()?.userId === person.userId"
                          (click)="toggleAccess(person)"
                        >
                          Edit access
                        </button>
                      }
                      <button
                        type="button"
                        bitIconButton="bwi-trash"
                        buttonType="danger"
                        [label]="'Remove ' + person.email"
                        (click)="removeStaff(person)"
                      ></button>
                    }
                  </td>
                </tr>
              }
              @for (invite of m.invites; track invite.id) {
                <tr bitRow [attr.data-testid]="'msp-invite-' + invite.email">
                  <td bitCell>
                    <div>
                      {{ invite.email }}
                      <span bitBadge variant="warning" class="tw-ml-2">Invited</span>
                    </div>
                  </td>
                  <td bitCell>{{ invite.role === "admin" ? "Admin" : "Technician" }}</td>
                  <td bitCell>
                    @if (invite.role === "admin") {
                      <span class="tw-text-muted">Owner of every client</span>
                    } @else {
                      {{ accessText(invite.access ?? defaultAccess) }}
                    }
                  </td>
                  <td bitCell class="tw-text-right">
                    @if (m.role === "admin") {
                      <button
                        type="button"
                        bitIconButton="bwi-close"
                        [label]="'Cancel the invitation for ' + invite.email"
                        (click)="cancelInvite(invite)"
                      ></button>
                    }
                  </td>
                </tr>
              }
            </ng-template>
          </bit-table>
          @if (accessFor(); as person) {
            <form
              [formGroup]="accessForm"
              [bitSubmit]="saveAccess"
              class="tw-mt-4 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
              aria-label="Access"
              data-testid="msp-access-editor"
            >
              <h3 bitTypography="h5">{{ person.name || person.email }}'s access</h3>
              <p bitTypography="body2">
                Changes apply to every client at once. Clients they no longer reach remove them
                right away.
              </p>
              <app-keykeeper-technician-access
                [clients]="m.clients"
                [access]="person.access ?? defaultAccess"
                (accessChange)="accessDraft.set($event)"
              />
              <div class="tw-mt-4 tw-flex tw-gap-2">
                <button bitButton bitFormButton buttonType="primary" type="submit">
                  Save access
                </button>
                <button
                  bitButton
                  buttonType="secondary"
                  type="button"
                  (click)="accessFor.set(null)"
                >
                  Cancel
                </button>
              </div>
            </form>
          }
          @if (lastInvite(); as invite) {
            <bit-callout type="success" [title]="null" data-testid="msp-invite-link">
              <p>
                {{ invite.email }} is invited, and joins once they accept.
                @if (invite.emailed) {
                  We emailed them this link.
                } @else {
                  Send them this link. They sign in with that email address, or create an account
                  with it, then open it.
                }
              </p>
              <pre class="tw-whitespace-pre-wrap tw-break-all tw-text-sm">{{
                invite.inviteUrl
              }}</pre>
              <button
                bitButton
                buttonType="secondary"
                type="button"
                (click)="copyText(invite.inviteUrl)"
              >
                Copy link
              </button>
            </bit-callout>
          }
          @if (m.role === "admin") {
            <form [formGroup]="staffForm" [bitSubmit]="addStaff" class="tw-mt-4">
              <div class="tw-flex tw-items-end tw-gap-2">
                <bit-form-field disableMargin class="tw-grow">
                  <bit-label>Email of someone to add</bit-label>
                  <input bitInput type="email" formControlName="email" />
                </bit-form-field>
                <bit-form-field disableMargin class="tw-min-w-36">
                  <bit-label>Role</bit-label>
                  <select bitInput formControlName="role">
                    <option value="technician">Technician</option>
                    <option value="admin">Admin</option>
                  </select>
                </bit-form-field>
                <button bitButton bitFormButton buttonType="primary" type="submit">
                  Add staff
                </button>
              </div>
              @if (staffForm.controls.role.value === "technician") {
                <p bitTypography="body2" class="tw-mb-0 tw-mt-2">
                  Access: {{ accessText(newStaffAccess() ?? defaultAccess) }}
                  <button
                    type="button"
                    bitLink
                    class="tw-ml-2"
                    [attr.aria-expanded]="newStaffAccess() != null"
                    (click)="toggleNewStaffAccess()"
                  >
                    {{ newStaffAccess() == null ? "Choose access" : "Use the default" }}
                  </button>
                </p>
                @if (newStaffAccess() != null) {
                  <div
                    class="tw-mt-2 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
                    data-testid="msp-new-staff-access"
                  >
                    <app-keykeeper-technician-access
                      [clients]="m.clients"
                      (accessChange)="newStaffAccess.set($event)"
                    />
                  </div>
                }
              }
            </form>
          }
        </section>

        <section class="tw-mt-8" aria-label="Activity">
          <h2 bitTypography="h3">Activity</h2>
          @if (events().length === 0) {
            <p bitTypography="body1">Nothing yet.</p>
          } @else {
            <ul class="tw-m-0 tw-list-none tw-p-0" data-testid="msp-activity">
              @for (e of events(); track e.id) {
                <li class="tw-border-0 tw-border-b tw-border-solid tw-border-secondary-300 tw-py-2">
                  <div bitTypography="body2">{{ describe(e, templateNames()) }}</div>
                  <div class="tw-text-xs tw-text-muted">
                    {{ e.date | date: "medium" }}
                    @if (e.ip) {
                      · {{ e.ip }}
                    }
                  </div>
                </li>
              }
            </ul>
            @if (moreEvents()) {
              <button
                bitButton
                buttonType="secondary"
                type="button"
                class="tw-mt-2"
                (click)="showOlder()"
              >
                Show older
              </button>
            }
          }
        </section>
      } @else {
        <bit-callout type="info" title="Set up your MSP">
          Run all of your clients from one place. You'll be an admin of your MSP, and you can add
          technicians next.
        </bit-callout>
        <form [formGroup]="mspForm" [bitSubmit]="createMsp" class="tw-flex tw-items-end tw-gap-2">
          <bit-form-field disableMargin class="tw-grow">
            <bit-label>Your MSP's name</bit-label>
            <input bitInput formControlName="name" />
          </bit-form-field>
          <button bitButton bitFormButton buttonType="primary" type="submit">Create MSP</button>
        </form>
      }
    </bit-container>
  `,
})
export class KeykeeperMspComponent implements OnInit {
  protected readonly CONFIRMED = CONFIRMED;
  protected readonly loading = signal(true);
  protected readonly msp = signal<MspDetails | null>(null);
  /**
   * For MSP admins, the clients this browser trusts (their client seal
   * checks out), so the others can be confirmed by name. Null until known.
   */
  protected readonly trusted = signal<Set<string> | null>(null);
  protected readonly invitation = signal<{ token: string; info: InvitationInfo } | null>(null);
  protected readonly lastInvite = signal<{
    email: string;
    inviteUrl: string;
    emailed: boolean;
  } | null>(null);
  protected readonly events = signal<MspEvent[]>([]);
  protected readonly moreEvents = signal(false);
  /** Template names by template id, for Activity; the server never sees them. */
  protected readonly templateNames = signal(new Map<string, string>());
  protected describe(e: MspEvent, names: Map<string, string>) {
    return describeEvent(e, (id) => names.get(id));
  }

  /** The templates sent to clients. Older servers have none. */
  protected readonly templates = signal<MspTemplates | null>(null);
  /** The default policies, and which clients have their own settings. Older servers have none. */
  protected readonly policies = signal<MspPolicies | null>(null);
  /** Upstream's forms for the policies the server offers, in the admin console's order. */
  protected readonly policyDefinitions = signal<BasePolicyEditDefinition[]>([]);
  /** A client whose key the person holds, for upstream's policy forms. */
  protected readonly keyedClientId = computed(
    () => this.msp()?.clients.find((c) => c.you?.status === CONFIRMED)?.id,
  );

  /** Password health per client, computed here from items MSP staff can decrypt. */
  protected readonly health = signal<Map<string, ClientHealth> | null>(null);
  /** How far the breach check has got, across every client. */
  protected readonly exposedCheck = signal<
    | { state: "checking"; checked: number; total: number }
    | { state: "done"; unchecked: number }
    | { state: "off" }
    | null
  >(null);
  /**
   * The person asked for the breach check on this visit, with their setting
   * for checking after unlocking off (KeykeeperBreachCheckSetting).
   */
  protected readonly exposedAsked = signal(false);
  /** The client whose passwords to fix are showing. */
  protected readonly detailsFor = signal<MspClient | null>(null);
  protected readonly exposedTitle =
    "Passwords found in known data breaches. Only the first 5 characters of each password's SHA-1 hash leave this browser.";
  /**
   * The newest health computation. Starting another, or leaving the console,
   * calls it off, with the breach checks it's still waiting on.
   */
  private readonly healthRuns: { latest: AbortController | null } = { latest: null };
  private readonly stopHealthOnLeave = inject(DestroyRef).onDestroy(() =>
    this.healthRuns.latest?.abort(),
  );
  /** Expired and soon-expiring items across the clients, from the same items. */
  protected readonly expiring = signal<ExpiringItem[] | null>(null);
  protected readonly installFor = signal<{
    client: MspClient;
    enrollment: ClientEnrollment;
    parts: InstallCommandParts | null;
  } | null>(null);
  private readonly serverUrl = signal("");

  protected readonly defaultAccess = DEFAULT_ACCESS;
  /** The technician whose access is being edited. */
  protected readonly accessFor = signal<MspStaffMember | null>(null);
  protected readonly accessDraft = signal<TechnicianAccess>(DEFAULT_ACCESS);
  protected readonly accessForm = this.formBuilder.group({});
  /** Access chosen for someone being added; null for the default. */
  protected readonly newStaffAccess = signal<TechnicianAccess | null>(null);

  protected readonly mspForm = this.formBuilder.group({
    name: ["", [Validators.required, Validators.maxLength(100)]],
  });
  protected readonly domainsForm = this.formBuilder.group({ domains: [""] });

  protected readonly clientForm = this.formBuilder.group({
    name: ["", [Validators.required, Validators.maxLength(100)]],
    preset: ["business" as ClientPreset, Validators.required],
  });
  protected readonly staffForm = this.formBuilder.group({
    email: ["", [Validators.required, Validators.email]],
    role: ["technician" as MspRole, Validators.required],
  });

  constructor(
    private readonly mspApi: KeykeeperMspApiService,
    private readonly formBuilder: FormBuilder,
    private readonly toastService: ToastService,
    private readonly sealer: KeykeeperJoinSealer,
    private readonly i18nService: I18nService,
    private readonly environmentService: EnvironmentService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly dialogService: DialogService,
    private readonly accountService: AccountService,
    private readonly cipherService: CipherService,
    private readonly passwordStrengthService: PasswordStrengthServiceAbstraction,
    private readonly exposureChecks: KeykeeperExposureChecks,
    private readonly breachCheck: KeykeeperBreachCheckSetting,
    private readonly syncService: SyncService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly configService: ConfigService,
    private readonly work: KeykeeperMspWorkService,
  ) {}

  async ngOnInit() {
    try {
      const token = this.route.snapshot.queryParamMap.get("invite");
      if (token) {
        this.invitation.set({ token, info: await this.mspApi.invitationInfo(token) });
      }
    } catch (e) {
      this.showError(e);
    }
    try {
      const [first] = await this.mspApi.list();
      if (first) {
        await this.confirmWaiting(first.id);
        await this.reload(first.id);
        // Brings clients' templates up to date; the section reloads if anything changed.
        void this.work.run();
      }
    } catch (e) {
      this.showError(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected readonly createMsp = async () => {
    if (this.mspForm.invalid) {
      this.mspForm.markAllAsTouched();
      return;
    }
    await this.attempt(async () => {
      const created = await this.mspApi.create(this.mspForm.value.name!.trim());
      await this.reload(created.id);
    });
  };

  protected readonly addClient = async () => {
    const msp = this.msp();
    if (this.clientForm.invalid || msp == null) {
      this.clientForm.markAllAsTouched();
      return;
    }
    await this.attempt(async () => {
      const name = this.clientForm.value.name!.trim();
      await this.mspApi.createClient(msp.id, name, this.clientForm.value.preset as ClientPreset);
      // Everyone else on staff joined the new client; give them its key now.
      await this.confirmWaiting(msp.id);
      this.clientForm.reset({ name: "", preset: "business" });
      this.toast(`Added ${name}`);
      // Templates for every client apply to the new one too.
      const failures = await this.work.run();
      if (failures.length > 0) {
        this.toastService.showToast({
          variant: "warning",
          message: `Not every template reached ${name} yet: ${failures.join("; ")}`,
        });
      }
      await this.reload(msp.id);
    });
  };

  protected readonly addStaff = async () => {
    const msp = this.msp();
    if (this.staffForm.invalid || msp == null) {
      this.staffForm.markAllAsTouched();
      return;
    }
    await this.attempt(async () => {
      const email = this.staffForm.value.email!.trim();
      const access = this.newStaffAccess() ?? undefined;
      const result = await this.mspApi.addStaff(
        msp.id,
        email,
        this.staffForm.value.role as MspRole,
        access,
      );
      const everyClient = this.staffForm.value.role === "admin" || reachesEveryClient(access);
      this.staffForm.reset({ email: "", role: "technician" });
      this.newStaffAccess.set(null);
      if (result.invited) {
        this.lastInvite.set({
          email: result.email,
          inviteUrl: result.inviteUrl,
          emailed: result.emailed,
        });
        await this.reload(msp.id);
        this.toast(`Invited ${result.email}`);
        return;
      }
      this.lastInvite.set(null);
      await this.confirmWaiting(msp.id);
      await this.reload(msp.id);
      const clients = access?.clients.length ?? 0;
      this.toast(
        everyClient
          ? `Added ${email} to every client`
          : `Added ${email} to ${clients === 1 ? "1 client" : `${clients} clients`}`,
      );
    });
  };

  protected toggleNewStaffAccess() {
    this.newStaffAccess.set(this.newStaffAccess() == null ? DEFAULT_ACCESS : null);
  }

  protected toggleAccess(person: MspStaffMember) {
    if (this.accessFor()?.userId === person.userId) {
      this.accessFor.set(null);
      return;
    }
    this.accessDraft.set(person.access ?? DEFAULT_ACCESS);
    this.accessFor.set(person);
  }

  protected readonly saveAccess = async () => {
    const msp = this.msp();
    const person = this.accessFor();
    if (msp == null || person == null) {
      return;
    }
    await this.attempt(async () => {
      await this.mspApi.setAccess(msp.id, person.userId, this.accessDraft());
      this.accessFor.set(null);
      // Clients they now reach are waiting for the org key; give it now.
      await this.confirmWaiting(msp.id);
      await this.reload(msp.id);
      this.toast(`Saved ${person.email}'s access`);
    });
  };

  protected accessText(access: TechnicianAccess): string {
    return describeAccess(access, this.msp()?.clients ?? []);
  }

  /** Into a client's admin console: Members for owners and admins, otherwise wherever their role starts. */
  protected openLink(client: MspClient): string[] {
    const type = client.you?.type ?? 2;
    return type <= 1 ? ["/organizations", client.id, "members"] : ["/organizations", client.id];
  }

  protected async cancelInvite(invite: MspInvite) {
    const msp = this.msp();
    if (msp == null) {
      return;
    }
    await this.attempt(async () => {
      await this.mspApi.cancelInvite(msp.id, invite.id);
      this.lastInvite.set(null);
      await this.reload(msp.id);
      this.toast(`Cancelled the invitation for ${invite.email}`);
    });
  }

  protected async acceptInvitation(token: string) {
    await this.attempt(async () => {
      const { mspId } = await this.mspApi.acceptInvitation(token);
      this.invitation.set(null);
      await this.router.navigate([], { queryParams: { invite: null }, replaceUrl: true });
      await this.reload(mspId);
      this.toast(`You joined ${this.msp()?.name}`);
    });
  }

  protected copyText(text: string) {
    this.platformUtilsService.copyToClipboard(text);
    this.toast("Copied");
  }

  protected async changeRole(person: MspStaffMember, role: MspRole) {
    const msp = this.msp();
    if (msp == null || role === person.role) {
      return;
    }
    await this.attempt(async () => {
      await this.mspApi.changeRole(msp.id, person.userId, role);
      this.accessFor.set(null);
      // A new admin joins clients they didn't reach before; give them the keys.
      await this.confirmWaiting(msp.id);
      this.toast(`${person.email} is now ${role === "admin" ? "an admin" : "a technician"}`);
    });
    await this.reload(msp.id);
  }

  protected async removeStaff(person: MspStaffMember) {
    const msp = this.msp();
    if (msp == null) {
      return;
    }
    await this.attempt(async () => {
      await this.mspApi.removeStaff(msp.id, person.userId);
      await this.reload(msp.id);
      this.toast(`Removed ${person.email} from every client`);
    });
  }

  protected async toggleInstall(client: MspClient) {
    const msp = this.msp();
    if (msp == null) {
      return;
    }
    if (this.installFor()?.client.id === client.id) {
      this.installFor.set(null);
      return;
    }
    await this.attempt(async () => {
      const environment = await firstValueFrom(this.environmentService.environment$);
      this.serverUrl.set(environment.getWebVaultUrl());
      const enrollment = await this.mspApi.getEnrollment(msp.id, client.id);
      this.domainsForm.setValue({ domains: enrollment.domains.join(" ") });
      await this.showInstall(msp.id, client, enrollment);
    });
  }

  /**
   * Shows a client's install command with its join secret and the client's
   * key fingerprint. A command made before join secrets gets one the first
   * time an MSP admin opens it, keeping its token.
   */
  private async showInstall(mspId: string, client: MspClient, enrollment: ClientEnrollment) {
    let parts = await this.sealer.commandParts(client.id, enrollment.secret);
    if (parts == null && enrollment.token != null && enrollment.secret == null) {
      if (this.msp()?.role === "admin") {
        await this.mspApi.setEnrollmentSecret(mspId, client.id);
        enrollment = await this.mspApi.getEnrollment(mspId, client.id);
        parts = await this.sealer.commandParts(client.id, enrollment.secret);
      }
    }
    this.installFor.set({ client, enrollment, parts });
  }

  protected domainList(domains: string[]): string {
    return domains.length < 2
      ? domains.join("")
      : `${domains.slice(0, -1).join(", ")} or ${domains[domains.length - 1]}`;
  }

  protected readonly saveDomains = async () => {
    const msp = this.msp();
    const install = this.installFor();
    if (msp == null || install == null) {
      return;
    }
    const domains = (this.domainsForm.value.domains ?? "").split(/[\s,;]+/).filter((d) => d !== "");
    await this.attempt(async () => {
      const enrollment = await this.mspApi.setEnrollmentDomains(msp.id, install.client.id, domains);
      this.domainsForm.setValue({ domains: enrollment.domains.join(" ") });
      this.installFor.set({ ...install, enrollment });
      this.toast(
        enrollment.domains.length
          ? `Only ${this.domainList(enrollment.domains)} accounts can join ${install.client.name} with the command`
          : `Anyone with the command can ask to join ${install.client.name}`,
      );
    });
  };

  /** The command an MSP runs from their RMM; the script's name comes from the brand. */
  protected installCommand(token: string): string | null {
    return installCommand(
      this.i18nService.t("keykeeperInstallScript"),
      this.serverUrl(),
      token,
      this.installFor()?.parts,
    );
  }

  protected readonly refusedCommand = INSTALL_COMMAND_REFUSED;

  // Keykeeper: offboarding's words (DESIGN.md, "Offboarding").
  protected readonly clientRemovedLine = clientRemovedLine;
  protected readonly removedByClientLine = removedByClientLine;
  protected readonly replaceTokenPrompt = (removedSinceToken: number | undefined) =>
    replaceTokenPrompt(removedSinceToken);

  protected copyCommand(token: string) {
    const command = this.installCommand(token);
    if (command == null) {
      this.toastService.showToast({ variant: "error", message: INSTALL_COMMAND_REFUSED });
      return;
    }
    this.platformUtilsService.copyToClipboard(command);
    this.toast("Copied the install command");
  }

  /**
   * A client an MSP admin holds the key of that this browser can't check is
   * the MSP's: one made before client seals, or one a server lists that isn't.
   */
  protected unconfirmedClient(client: MspClient): boolean {
    const trusted = this.trusted();
    return trusted != null && client.you?.status === CONFIRMED && !trusted.has(client.id);
  }

  /**
   * Seals that a client is this MSP's, once an admin says so by name. Until
   * then nothing is sealed or copied there in the background (DESIGN.md,
   * "Joins a hacked server can't forge").
   */
  protected async confirmClient(client: MspClient) {
    const msp = this.msp();
    if (msp == null) {
      return;
    }
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Is ${client.name} your client?`,
      content: `Confirm only an organization ${msp.name} manages. Until a client is confirmed, PassBundle doesn't copy your templates there or vouch for your staff joining it, so a hacked server can't point that work at another organization you belong to.`,
      acceptButtonText: "Confirm client",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    await this.attempt(async () => {
      await this.mspApi.confirmClient(msp.id, client.id);
      this.toast(`Confirmed ${client.name}`);
      await this.reload(msp.id);
      void this.work.run();
    });
  }

  protected async replaceToken(client: MspClient) {
    const msp = this.msp();
    if (msp == null) {
      return;
    }
    const hadToken = this.installFor()?.enrollment.token != null;
    if (hadToken) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: "Replace the install token?",
        content: `Install commands already run on ${client.name}'s computers stop letting new people join. Run the new command there instead.`,
        acceptButtonText: "Replace token",
        type: "warning",
      });
      if (!confirmed) {
        return;
      }
    }
    await this.attempt(async () => {
      const enrollment = await this.mspApi.replaceEnrollment(msp.id, client.id);
      await this.showInstall(msp.id, client, enrollment);
      this.toast(hadToken ? "Replaced the install token" : "Created the install command");
    });
  }

  protected async reload(mspId: string) {
    const msp = await this.mspApi.get(mspId);
    this.msp.set(msp);
    this.trusted.set(msp.role === "admin" ? await this.mspApi.trustedClientIds(mspId, msp) : null);
    void this.computeHealth(msp);
    await this.loadPolicies(mspId);
    await this.loadTemplates(mspId);
    const events = await this.mspApi.listEvents(mspId);
    this.events.set(events);
    this.moreEvents.set(events.length === EVENTS_PER_PAGE);
  }

  private async loadTemplates(mspId: string) {
    try {
      this.templates.set(await this.mspApi.getTemplates(mspId));
    } catch {
      // A server without templates.
      this.templates.set(null);
    }
  }

  private async loadPolicies(mspId: string) {
    let policies: MspPolicies;
    try {
      policies = await this.mspApi.getPolicies(mspId);
    } catch {
      // A server without default policies.
      this.policies.set(null);
      return;
    }
    if (this.policyDefinitions().length === 0) {
      const definitions: BasePolicyEditDefinition[] = [];
      for (const definition of ossPolicyEditRegister) {
        if (
          policies.types.includes(definition.type) &&
          (await firstValueFrom(definition.display$(CLIENT_FEATURES, this.configService)))
        ) {
          definitions.push(definition);
        }
      }
      this.policyDefinitions.set(definitions);
    }
    this.policies.set(policies);
  }

  protected policySummary(client: MspClient): string {
    return clientPolicySummary(
      this.policies(),
      client.id,
      this.policyDefinitions().map((d) => d.type),
    );
  }

  protected async showOlder() {
    const msp = this.msp();
    const oldest = this.events().at(-1);
    if (msp == null || oldest == null) {
      return;
    }
    await this.attempt(async () => {
      const older = await this.mspApi.listEvents(msp.id, oldest.date, EVENTS_PER_PAGE);
      this.events.set([...this.events(), ...older]);
      this.moreEvents.set(older.length === EVENTS_PER_PAGE);
    });
  }

  private async computeHealth(msp: MspDetails) {
    this.healthRuns.latest?.abort();
    const run = new AbortController();
    this.healthRuns.latest = run;
    try {
      // Picks up items added elsewhere, such as in a client's admin console.
      await this.syncService.fullSync(false);
      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      const ciphers = await this.cipherService.getAllDecrypted(userId);
      if (run.signal.aborted) {
        return;
      }
      this.templateNames.set(
        new Map(
          ciphers.flatMap((c) => {
            const definition = templateDefinition(c);
            return definition ? [[definition.id, c.name] as [string, string]] : [];
          }),
        ),
      );
      this.expiring.set(
        expiringItems(
          ciphers,
          msp.clients.map(({ id, name }) => ({ id, name })),
        ),
      );
      const clientIds = msp.clients.map((c) => c.id);
      // Scored once per password and username for both passes below; kept
      // only while this runs.
      const scores = new Map<string, number | null>();
      const score: StrengthScorer = (password, hints) => {
        const key = `${password}\u0000${hints?.join("\u0000") ?? ""}`;
        if (!scores.has(key)) {
          scores.set(
            key,
            this.passwordStrengthService.getPasswordStrength(password, null, hints)?.score ?? null,
          );
        }
        return scores.get(key)!;
      };
      // Weak and reused first; exposed follows when the breach check is done.
      this.health.set(clientHealth(ciphers, clientIds, score));
      // With checking after unlocking off, nothing goes to the breach service
      // until the person asks. Automatic checks read the setting again just
      // before each request, so one turned off meanwhile sends nothing more.
      const automatic = !this.exposedAsked();
      const mayAsk = () => firstValueFrom(this.breachCheck.activeChecksAfterUnlock$);
      if (automatic && !(await mayAsk())) {
        if (!run.signal.aborted) {
          this.exposedCheck.set({ state: "off" });
        }
        return;
      }

      // Each different password once, across every client, in random order,
      // through the one k-anonymity client (only 5 characters of each hash
      // are sent).
      let exposed: Map<string, number | null>;
      try {
        exposed = await this.exposureChecks.check(clientItemsToCheck(ciphers, clientIds), {
          signal: run.signal,
          mayAsk: automatic ? mayAsk : undefined,
          progress: (checked, total) => {
            if (!run.signal.aborted) {
              this.exposedCheck.set({ state: "checking", checked, total });
            }
          },
        });
      } catch (e) {
        if (e instanceof PwnedPasswordsCancelledError) {
          // Turned off meanwhile; a newer run or leaving says nothing.
          if (!run.signal.aborted) {
            this.exposedCheck.set({ state: "off" });
          }
          return;
        }
        throw e;
      }
      if (run.signal.aborted) {
        return;
      }
      const health = clientHealth(ciphers, clientIds, score, new Date(), exposed);
      this.health.set(health);
      // Items, as everywhere else that counts what couldn't be checked.
      const unchecked = [...health.values()].reduce((sum, client) => sum + client.unchecked, 0);
      this.exposedCheck.set({ state: "done", unchecked });
    } catch (e) {
      if (!run.signal.aborted) {
        this.showError(e);
      }
    }
  }

  /** "1 item" or "N items": what couldn't be checked is counted in items everywhere. */
  protected itemCount(count: number): string {
    return count === 1 ? "1 item" : `${count} items`;
  }

  /** Checks for exposed passwords when the person's setting doesn't on its own. */
  protected checkByHand(msp: MspDetails) {
    this.exposedAsked.set(true);
    this.exposedCheck.set(null);
    void this.computeHealth(msp);
  }

  /** Checks for exposed passwords again, after the breach service couldn't be reached. */
  protected checkAgain(msp: MspDetails) {
    this.exposedCheck.set(null);
    void this.computeHealth(msp);
  }

  /** Whether the person can open a client's items, so its health details can list them by name. */
  protected seesItems(client: MspClient): boolean {
    return client.you?.status === CONFIRMED && client.you.vaultItems !== false;
  }

  /** A health count opens the client's list of what to fix when there's something in it. */
  protected opensDetails(client: MspClient, value: number | string): boolean {
    return (
      this.seesItems(client) &&
      value !== 0 &&
      value !== "..." &&
      value !== "-" &&
      value !== "Not checked"
    );
  }

  protected toggleDetails(client: MspClient) {
    this.detailsFor.set(this.detailsFor()?.id === client.id ? null : client);
  }

  protected exposedLabel(item: ItemToFix): string {
    const times = (item.exposed ?? 0).toLocaleString("en-US");
    return item.exposed === 1 ? "Exposed once" : `Exposed ${times} times`;
  }

  /**
   * Opens an item: in the client's admin console for its owners and admins,
   * otherwise in the person's own vault, since a custom role can't load the
   * admin console's vault.
   */
  protected itemLink(client: MspClient, item: ItemToFix) {
    const query = { itemId: item.id, action: "view" };
    return (client.you?.type ?? 2) <= 1
      ? { path: ["/organizations", item.organizationId, "vault"], query }
      : { path: ["/vault"], query };
  }

  protected badgeLabel(item: ExpiringItem) {
    return expirationLabel(item.status);
  }

  protected badgeVariant(item: ExpiringItem) {
    return expirationBadgeVariant(item.status);
  }

  /** A client's health figures for the table: a dash where you can't see its items. */
  protected healthOf(client: MspClient): {
    expiring: number | string;
    weak: number | string;
    reused: number | string;
    exposed: number | string;
    exposedNote: string | null;
  } {
    if (!this.seesItems(client)) {
      return { expiring: "-", weak: "-", reused: "-", exposed: "-", exposedNote: null };
    }
    const health = this.health()?.get(client.id);
    if (health == null) {
      return { expiring: "...", weak: "...", reused: "...", exposed: "...", exposedNote: null };
    }
    const off = this.exposedCheck()?.state === "off";
    let exposed: number | string = health.exposed ?? (off ? "Not checked" : "...");
    let exposedNote: string | null =
      health.exposed !== undefined ? null : off ? "Checking after unlocking is off" : "Checking";
    if (health.unchecked > 0) {
      exposed = health.exposed ? `${health.exposed}+` : "Couldn't check";
      exposedNote = `${this.itemCount(health.unchecked)} couldn't be checked for breaches`;
    }
    return { ...health, exposed, exposedNote };
  }

  private async confirmWaiting(mspId: string) {
    const { confirmed, failed } = await this.work.confirmPending(mspId);
    if (confirmed > 0) {
      this.toast(confirmed === 1 ? "Confirmed 1 member" : `Confirmed ${confirmed} members`);
    }
    if (failed.length > 0) {
      this.toastService.showToast({
        variant: "error",
        message: `Couldn't confirm ${failed.join("; ")}`,
      });
    }
  }

  private async attempt(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      this.showError(e);
    }
  }

  private toast(message: string) {
    this.toastService.showToast({ variant: "success", message });
  }

  private showError(e: unknown) {
    const message =
      e instanceof ErrorResponse
        ? e.getSingleMessage()
        : e instanceof Error
          ? e.message
          : String(e);
    this.toastService.showToast({ variant: "error", message });
  }
}
