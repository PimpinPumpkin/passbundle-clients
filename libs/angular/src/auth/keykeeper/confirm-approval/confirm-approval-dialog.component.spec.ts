import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";

import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogRef } from "@bitwarden/components";

import { KeykeeperConfirmApprovalDialogComponent } from "./confirm-approval-dialog.component";

describe("KeykeeperConfirmApprovalDialogComponent", () => {
  let fixture: ComponentFixture<KeykeeperConfirmApprovalDialogComponent>;
  let component: KeykeeperConfirmApprovalDialogComponent;
  let dialogRef: MockProxy<DialogRef<boolean>>;
  let userVerificationService: MockProxy<UserVerificationService>;

  beforeEach(async () => {
    dialogRef = mock<DialogRef<boolean>>();
    userVerificationService = mock<UserVerificationService>();
    const i18nService = mock<I18nService>();
    i18nService.t.mockImplementation((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [KeykeeperConfirmApprovalDialogComponent],
      providers: [
        { provide: DialogRef, useValue: dialogRef },
        { provide: UserVerificationService, useValue: userVerificationService },
        { provide: I18nService, useValue: i18nService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KeykeeperConfirmApprovalDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const typeAndConfirm = async (password: string) => {
    (component as any).form.setValue({ masterPassword: password });
    await (component as any).confirm();
    fixture.detectChanges();
  };

  const wrongShown = () =>
    fixture.nativeElement.querySelector("[data-testid=keykeeper-confirm-approval-wrong]");

  it("closes with true once the master password checks out on this device", async () => {
    userVerificationService.verifyUser.mockResolvedValue(true);

    await typeAndConfirm("the right one");

    expect(userVerificationService.verifyUser).toHaveBeenCalledWith({
      type: VerificationType.MasterPassword,
      secret: "the right one",
    });
    expect(dialogRef.close).toHaveBeenCalledWith(true);
    expect(wrongShown()).toBeNull();
  });

  it("says a wrong password is wrong, and doesn't close: nothing is sent", async () => {
    // Upstream's verification throws for a wrong master password.
    userVerificationService.verifyUser.mockRejectedValue(new Error("invalidMasterPassword"));

    await typeAndConfirm("a wrong one");

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(wrongShown()).not.toBeNull();
  });

  it("holds the password only while it's checked: the field is emptied either way", async () => {
    userVerificationService.verifyUser.mockImplementation(async () => {
      // While the check runs, the field is empty already.
      expect((component as any).form.value.masterPassword ?? "").toBe("");
      throw new Error("invalidMasterPassword");
    });

    await typeAndConfirm("a wrong one");

    expect((component as any).form.value.masterPassword ?? "").toBe("");
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      "[data-testid=keykeeper-confirm-approval-password]",
    );
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
  });

  it("checks nothing without a password", async () => {
    await typeAndConfirm("");

    expect(userVerificationService.verifyUser).not.toHaveBeenCalled();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("Cancel closes with false", () => {
    (component as any).cancel();

    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });
});
