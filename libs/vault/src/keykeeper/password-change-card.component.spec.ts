import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { EventCollectionService, EventType } from "@bitwarden/common/dirt/event-logs";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import {
  fieldsWithMarker,
  readPasswordChangeMarker,
  withNewPassword,
} from "@bitwarden/common/vault/keykeeper/password-change";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";
import { ToastService } from "@bitwarden/components";

import { KeykeeperPasswordChangeCardComponent } from "./password-change-card.component";
import { KeykeeperPasswordChangeService } from "./password-change.service";

const savedAt = new Date("2026-11-08T10:00:00.000Z");

/** A login after a change: the new password saved, the old one in password history, the marker in a state. */
function changedItem(state: "pending" | "refused" | "unsure" = "pending"): CipherView {
  const item = new CipherView();
  item.id = "item-1";
  item.type = CipherType.Login;
  item.edit = true;
  item.viewPassword = true;
  item.login = new LoginView();
  item.login.password = "old-password-1";
  const website = new LoginUriView();
  website.uri = "https://accounts.example.test";
  item.login.uris = [website];
  const changed = withNewPassword(item, "new-password-2", "accounts.example.test", savedAt);
  changed.login.passwordRevisionDate = new Date(savedAt.getTime() + 10);
  const history = new PasswordHistoryView();
  history.password = "old-password-1";
  history.lastUsedDate = changed.login.passwordRevisionDate;
  changed.passwordHistory = [history];
  const marker = readPasswordChangeMarker(changed)!;
  changed.fields = fieldsWithMarker(changed.fields, { ...marker, state }) as FieldView[];
  return changed;
}

describe("KeykeeperPasswordChangeCardComponent", () => {
  let fixture: ComponentFixture<KeykeeperPasswordChangeCardComponent>;
  let cipherService: MockProxy<CipherService>;
  let toastService: MockProxy<ToastService>;
  let changeService: MockProxy<KeykeeperPasswordChangeService>;
  let events: MockProxy<EventCollectionService>;
  let saved: CipherView[];

  async function render(item: CipherView | null, withService = false) {
    await TestBed.configureTestingModule({
      imports: [KeykeeperPasswordChangeCardComponent],
      providers: [
        { provide: AccountService, useValue: { activeAccount$: of({ id: "user-1" as UserId }) } },
        { provide: CipherService, useValue: cipherService },
        {
          provide: I18nService,
          useValue: {
            t: (key: string, ...p: string[]) => [key, ...p].join(" "),
            translationLocale: "en-US",
          },
        },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: ToastService, useValue: toastService },
        { provide: EventCollectionService, useValue: events },
        ...(withService
          ? [{ provide: KeykeeperPasswordChangeService, useValue: changeService }]
          : []),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperPasswordChangeCardComponent);
    fixture.componentRef.setInput("cipher", item);
    fixture.componentInstance.saved.subscribe((s) => saved.push(s));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const card = () =>
    fixture.nativeElement.querySelector("[data-testid=keykeeper-password-change-card]");
  const button = (id: string) =>
    fixture.nativeElement.querySelector(
      `[data-testid=keykeeper-password-change-${id}]`,
    ) as HTMLButtonElement | null;

  beforeEach(() => {
    cipherService = mock<CipherService>();
    cipherService.updateWithServer.mockImplementation(async (draft) => draft);
    toastService = mock<ToastService>();
    changeService = mock<KeykeeperPasswordChangeService>();
    changeService.status.mockResolvedValue(null);
    events = mock<EventCollectionService>();
    events.collect.mockResolvedValue(undefined);
    saved = [];
  });

  it("asks whether the new password worked, with both buttons", async () => {
    await render(changedItem("unsure"));
    expect(card().textContent).toContain("keykeeperPasswordChangeUnsureText");
    expect(card().textContent).toContain("accounts.example.test");
    expect(button("put-back")).not.toBeNull();
    expect(button("it-worked")).not.toBeNull();
  });

  it("says the site didn't take it when it refused", async () => {
    await render(changedItem("refused"));
    expect(card().textContent).toContain("keykeeperPasswordChangeRefusedText");
  });

  it("puts the old password back in one click, as an edit of the item as shown", async () => {
    const item = changedItem("refused");
    await render(item);
    button("put-back")!.click();
    await fixture.whenStable();
    const [draft, , original] = cipherService.updateWithServer.mock.calls[0];
    expect(draft.login.password).toBe("old-password-1");
    expect(readPasswordChangeMarker(draft)).toBeNull();
    expect(original).toBe(item);
    expect(saved).toHaveLength(1);
  });

  it("tells an organization's event log when the old password comes back", async () => {
    const shared = changedItem("refused");
    shared.organizationId = "org-1";
    await render(shared);
    button("put-back")!.click();
    await fixture.whenStable();
    expect(events.collect).toHaveBeenCalledWith(
      EventType.Keykeeper_CipherPasswordPutBack,
      "item-1",
      true,
      "org-1",
    );
  });

  it("sends no event for a personal item", async () => {
    await render(changedItem("refused"));
    button("put-back")!.click();
    await fixture.whenStable();
    expect(events.collect).not.toHaveBeenCalled();
  });

  it("keeps the new password when it worked, taking the marker off", async () => {
    await render(changedItem());
    button("it-worked")!.click();
    await fixture.whenStable();
    const [draft] = cipherService.updateWithServer.mock.calls[0];
    expect(draft.login.password).toBe("new-password-2");
    expect(readPasswordChangeMarker(draft)).toBeNull();
  });

  it("says so when the save fails, and keeps the card, sending no event", async () => {
    cipherService.updateWithServer.mockRejectedValue(new Error("stale"));
    const shared = changedItem();
    shared.organizationId = "org-1";
    await render(shared);
    button("put-back")!.click();
    await fixture.whenStable();
    expect(events.collect).not.toHaveBeenCalled();
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "keykeeperPasswordChangeSaveFailed" }),
    );
    expect(saved).toHaveLength(0);
  });

  it("shows nothing for an item without an unfinished change", async () => {
    const item = changedItem();
    item.login.passwordRevisionDate = new Date(savedAt.getTime() + 24 * 3600_000);
    await render(item);
    expect(card()).toBeNull();
  });

  it("shows nothing to someone who can't edit the item or see its password", async () => {
    const readOnly = changedItem();
    readOnly.edit = false;
    await render(readOnly);
    expect(card()).toBeNull();
  });

  it("says a change still runs in this browser, without buttons", async () => {
    changeService.status.mockResolvedValue({ running: true, text: "Submitting the new password" });
    await render(changedItem(), true);
    expect(card().textContent).toContain("Submitting the new password");
    expect(button("put-back")).toBeNull();
    expect(button("it-worked")).toBeNull();
  });

  it("offers no put-back without the old password in password history", async () => {
    const item = changedItem();
    item.passwordHistory = [];
    await render(item);
    expect(button("put-back")).toBeNull();
    expect(button("it-worked")).not.toBeNull();
  });
});
