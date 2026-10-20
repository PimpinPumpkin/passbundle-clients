import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { FILL_RULE_FIELD_NAME, FillRule } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { CipherFormContainer } from "../cipher-form/cipher-form-container";

import { KeykeeperFillRulesFieldComponent } from "./fill-rules-field.component";
import { KeykeeperFillRulesViewComponent } from "./fill-rules-view.component";

const field = (name: string, value: string) => Object.assign(new FieldView(), { name, value });
const stored = (rule: FillRule) => field(FILL_RULE_FIELD_NAME, JSON.stringify(rule));

const customerId: FillRule = {
  v: 1,
  host: "bank.example",
  field: { label: "customer number" },
  fill: { from: "field", name: "Customer ID" },
};
const neverPin: FillRule = {
  v: 1,
  host: "bank.example",
  field: { id: "pin" },
  fill: { from: "never" },
};

function item(): CipherView {
  const cipher = new CipherView();
  cipher.fields = [field("Customer ID", "12345"), stored(customerId), stored(neverPin)];
  return cipher;
}

const text = (fixture: ComponentFixture<unknown>) =>
  (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, " ") ?? "";

describe("KeykeeperFillRulesFieldComponent", () => {
  let fixture: ComponentFixture<KeykeeperFillRulesFieldComponent>;
  let container: ReturnType<typeof mock<CipherFormContainer>>;
  let edited: CipherView;

  async function render(initial: CipherView | null, mode: "edit" | "partial-edit" = "edit") {
    edited = initial ?? new CipherView();
    container = mock<CipherFormContainer>();
    container.getInitialCipherView.mockReturnValue(initial);
    container.patchCipher.mockImplementation((update) => {
      edited = update(edited);
    });
    Object.defineProperty(container, "config", { value: { mode } });
    await TestBed.configureTestingModule({
      imports: [KeykeeperFillRulesFieldComponent],
      providers: [{ provide: CipherFormContainer, useValue: container }],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperFillRulesFieldComponent);
    fixture.detectChanges();
  }

  const removeButtons = () =>
    fixture.nativeElement.querySelectorAll(
      "[data-testid=remove-fill-rule]",
    ) as NodeListOf<HTMLButtonElement>;

  it("lists the item's rules in plain language", async () => {
    await render(item());

    expect(text(fixture)).toContain(
      'bank.example: the field labeled "customer number" gets the Customer ID field',
    );
    expect(text(fixture)).toContain(
      "bank.example: the field with id pin gets nothing (never fill)",
    );
    expect(removeButtons()).toHaveLength(2);
  });

  it("removes one rule from the item being edited and keeps everything else", async () => {
    await render(item());

    removeButtons()[0].click();
    fixture.detectChanges();

    expect(edited.fields.map((f) => f.name)).toEqual(["Customer ID", FILL_RULE_FIELD_NAME]);
    expect(JSON.parse(edited.fields[1].value)).toEqual(neverPin);
    expect(text(fixture)).not.toContain("customer number");
    expect(removeButtons()).toHaveLength(1);
  });

  it("doesn't offer removing rules to someone who can't edit the item", async () => {
    await render(item(), "partial-edit");

    expect(text(fixture)).toContain("the field with id pin");
    expect(removeButtons()).toHaveLength(0);
  });

  it("shows nothing for an item without rules, or a new item", async () => {
    const plain = new CipherView();
    plain.fields = [field("Customer ID", "12345")];
    await render(plain);
    expect(text(fixture).trim()).toBe("");

    TestBed.resetTestingModule();
    await render(null);
    expect(text(fixture).trim()).toBe("");
  });
});

describe("KeykeeperFillRulesViewComponent", () => {
  it("lists the rules, and says when a rule's custom field is gone", async () => {
    const cipher = item();
    cipher.fields = cipher.fields.filter((f) => f.name !== "Customer ID");
    await TestBed.configureTestingModule({
      imports: [KeykeeperFillRulesViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(KeykeeperFillRulesViewComponent);
    fixture.componentRef.setInput("cipher", cipher);
    fixture.detectChanges();

    expect(text(fixture)).toContain("Fill rules");
    expect(text(fixture)).toContain(
      'the field labeled "customer number" gets the Customer ID field, which this item doesn\'t have',
    );
    expect(text(fixture)).toContain("the field with id pin gets nothing (never fill)");

    fixture.componentRef.setInput("cipher", new CipherView());
    fixture.detectChanges();
    expect(text(fixture).trim()).toBe("");
  });
});
