import { CommonModule } from "@angular/common";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ReactiveFormsModule } from "@angular/forms";
import { By } from "@angular/platform-browser";
import { mock, MockProxy } from "jest-mock-extended";
import { Subject } from "rxjs";

import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { CipherFormContainer } from "../../cipher-form-container";

import { CardDetailsSectionComponent } from "./card-details-section.component";

describe("CardDetailsSectionComponent", () => {
  let component: CardDetailsSectionComponent;
  let fixture: ComponentFixture<CardDetailsSectionComponent>;
  let cipherFormProvider: MockProxy<CipherFormContainer>;
  let registerChildFormSpy: jest.SpyInstance;
  let patchCipherSpy: jest.SpyInstance;

  const getInitialCipherView = jest.fn((): any => null);

  beforeEach(async () => {
    cipherFormProvider = mock<CipherFormContainer>({
      getInitialCipherView,
      formStatusChange$: new Subject<"enabled" | "disabled">(),
      // A new card: no original item, so it's the person's own.
      originalCipherView: null,
    });
    registerChildFormSpy = jest.spyOn(cipherFormProvider, "registerChildForm");
    patchCipherSpy = jest.spyOn(cipherFormProvider, "patchCipher");

    await TestBed.configureTestingModule({
      imports: [CardDetailsSectionComponent, CommonModule, ReactiveFormsModule],
      providers: [
        { provide: EventCollectionService, useValue: mock<EventCollectionService>() },
        { provide: CipherFormContainer, useValue: cipherFormProvider },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CardDetailsSectionComponent);
    component = fixture.componentInstance;
    component.cardDetailsForm.reset({
      cardholderName: null,
      number: null,
      brand: null,
      expMonth: null,
      expYear: null,
      code: null,
    });
    fixture.detectChanges();
  });

  it("registers `cardDetailsForm` with `CipherFormContainer`", () => {
    expect(registerChildFormSpy).toHaveBeenCalledWith("cardDetails", component.cardDetailsForm);
  });

  it("patches `cardDetailsForm` changes to cipherFormContainer", () => {
    component.cardDetailsForm.patchValue({
      cardholderName: "Ron Burgundy",
      number: "4242 4242 4242 4242",
    });

    const cardView = new CardView();
    cardView.cardholderName = "Ron Burgundy";
    cardView.number = "4242 4242 4242 4242";
    cardView.brand = "Visa";
    cardView.expMonth = "";
    cardView.code = "";
    cardView.expYear = "";

    expect(patchCipherSpy).toHaveBeenCalled();
    const patchFn = patchCipherSpy.mock.lastCall[0];

    const updateCipher = patchFn(new CipherView());
    expect(updateCipher.card).toEqual(cardView);
  });

  it("it converts the year integer to a string", () => {
    component.cardDetailsForm.patchValue({
      expYear: 2022,
    });

    const cardView = new CardView();
    cardView.cardholderName = "";
    cardView.number = "";
    cardView.expMonth = "";
    cardView.code = "";
    cardView.brand = "";
    cardView.expYear = "2022";

    expect(patchCipherSpy).toHaveBeenCalled();
    const patchFn = patchCipherSpy.mock.lastCall[0];

    const updatedCipher = patchFn(new CipherView());
    expect(updatedCipher.card).toEqual(cardView);
  });

  it('disables `cardDetailsForm` when "disabled" is true', () => {
    component.disabled = true;

    component.ngOnInit();

    expect(component.cardDetailsForm.disabled).toBe(true);
  });

  it("initializes `cardDetailsForm` from `getInitialCipherValue`", () => {
    const cardholderName = "Ron Burgundy";
    const number = "4242 4242 4242 4242";
    const code = "619";
    const brand = "Maestro";
    const expMonth = "5";
    const expYear = "2028";

    const cardView = new CardView();
    cardView.cardholderName = cardholderName;
    cardView.number = number;
    cardView.code = code;
    cardView.brand = brand;
    cardView.expMonth = expMonth;
    cardView.expYear = expYear;

    getInitialCipherView.mockReturnValueOnce({ card: cardView });

    component.ngOnInit();

    expect(component.cardDetailsForm.value).toEqual({
      cardholderName,
      number,
      code,
      brand,
      expMonth,
      expYear,
    });
  });

  it("sets brand based on number changes", () => {
    const numberInput = fixture.debugElement.query(By.css('input[formControlName="number"]'));
    numberInput.nativeElement.value = "4111 1111 1111 1111";
    numberInput.nativeElement.dispatchEvent(new Event("input"));

    expect(component.cardDetailsForm.controls.brand.value).toBe("Visa");
  });

  it('displays brand heading text when "brand" is not "Other"', () => {
    component.cardDetailsForm.patchValue({
      brand: "Visa",
    });

    fixture.detectChanges();

    const heading = fixture.debugElement.query(By.css("h2"));

    expect(heading.nativeElement.textContent.trim()).toBe("cardBrandDetails");

    component.cardDetailsForm.patchValue({
      brand: "Other",
    });

    fixture.detectChanges();

    expect(heading.nativeElement.textContent.trim()).toBe("cardDetails");
  });

  it("initializes `cardDetailsForm` from `initialValues` when provided and editing existing cipher", () => {
    const initialCardholderName = "New Name";
    const initialBrand = "Amex";

    (cipherFormProvider as any).config = {
      initialValues: {
        cardholderName: initialCardholderName,
        brand: initialBrand,
      },
    };

    const existingCard = new CardView();
    existingCard.cardholderName = "Old Name";
    existingCard.brand = "Visa";

    getInitialCipherView.mockReturnValueOnce({ card: existingCard });

    component.ngOnInit();

    expect(component.cardDetailsForm.value.cardholderName).toBe(initialCardholderName);
    expect(component.cardDetailsForm.value.brand).toBe(initialBrand);
  });

  it("Keykeeper: never shows or changes a card's number and code for someone who can't see them", () => {
    const existingCard = new CardView();
    existingCard.cardholderName = "Ana";
    existingCard.number = "4242424242424242";
    existingCard.code = "123";
    const original = new CipherView();
    original.card = existingCard;
    original.viewPassword = false;
    getInitialCipherView.mockReturnValue({ card: existingCard });
    component.originalCipherView = original;

    component.ngOnInit();
    fixture.detectChanges();

    expect(component.canSeeSecrets).toBe(false);
    expect(component.cardDetailsForm.controls.number.disabled).toBe(true);
    expect(component.cardDetailsForm.controls.code.disabled).toBe(true);
    expect(
      fixture.debugElement.query(By.css('[data-testid="visibility-for-card-number"]')),
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="visibility-for-card-code"]')),
    ).toBeNull();

    // A save keeps them as they were.
    patchCipherSpy.mockClear();
    component.cardDetailsForm.controls.cardholderName.setValue("Ana Example");
    const cipher = new CipherView();
    cipher.card = new CardView();
    const patched = patchCipherSpy.mock.lastCall[0](cipher);
    expect(patched.card.number).toBe("4242424242424242");
    expect(patched.card.code).toBe("123");
    getInitialCipherView.mockReset();
    getInitialCipherView.mockImplementation(() => null);
  });
});
