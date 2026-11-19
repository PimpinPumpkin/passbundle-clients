import { createAutofillFieldMock, createAutofillPageDetailsMock } from "../spec/autofill-mocks";

import {
  addressPartByName,
  addressPartsInForm,
  isAddressFieldByName,
  isStreetTextArea,
} from "./address-fields";

/** A field known only by its name and label, in the form "f1" unless it says otherwise. */
const field = (id: string, label: string, custom: Record<string, unknown> = {}) =>
  createAutofillFieldMock({
    opid: id,
    htmlID: id,
    htmlName: id,
    htmlClass: "",
    title: "",
    "label-tag": label,
    "label-aria": "",
    "label-left": "",
    "label-top": "",
    placeholder: "",
    autoCompleteType: "",
    tagName: "input",
    type: "text",
    form: "f1",
    viewable: true,
    ...custom,
  });
const list = (id: string, label: string, custom: Record<string, unknown> = {}) =>
  field(id, label, { tagName: "select", type: "select-one", ...custom });
const textArea = (id: string, label: string, custom: Record<string, unknown> = {}) =>
  field(id, label, { tagName: "textarea", type: "textarea", ...custom });

/** A checkout's address known only by labels. */
const addressForm = () => [
  field("fullname", "Full name"),
  textArea("street", "Street address"),
  field("city", "City"),
  list("state", "State"),
  field("zip", "ZIP code"),
  list("country", "Country/Region"),
  field("phone", "Phone"),
];

describe("the address part a field's name or label names", () => {
  it("is a whole word, or words run together", () => {
    expect(addressPartByName(field("a", "Street address"))).toBe("street");
    expect(addressPartByName(field("addressLine1", ""))).toBe("street");
    expect(addressPartByName(field("address_line_2", ""))).toBe("street");
    expect(addressPartByName(field("strasse", "Straße und Hausnummer"))).toBe("street");
    expect(addressPartByName(field("a", "Town / City"))).toBe("city");
    expect(addressPartByName(field("ort", "Ort"))).toBe("city");
    expect(addressPartByName(field("a", "State / Province"))).toBe("state");
    expect(addressPartByName(field("a", "Bundesland"))).toBe("state");
    expect(addressPartByName(field("postalCode", ""))).toBe("postal");
    expect(addressPartByName(field("a", "ZIP code"))).toBe("postal");
    expect(addressPartByName(field("plz", "PLZ"))).toBe("postal");
    expect(addressPartByName(field("a", "Country/Region"))).toBe("country");
    expect(addressPartByName(field("land", "Land"))).toBe("country");
  });

  it("is the city or country, not the street, for names like address_city", () => {
    expect(addressPartByName(field("address_city", ""))).toBe("city");
    expect(addressPartByName(field("address[country]", ""))).toBe("country");
  });

  it("counts a name, a company, or a phone apart from the address", () => {
    expect(addressPartByName(field("a", "Full name"))).toBe("name");
    expect(addressPartByName(field("a", "Company"))).toBe("company");
    expect(addressPartByName(field("a", "Phone"))).toBe("phone");
  });

  it("is nothing inside another word, or for a field that says it's something else", () => {
    for (const label of [
      "Statement",
      "Portfolio",
      "Island",
      "Search by city",
      "Email address",
      "E-Mail-Adresse",
      "Delivery instructions",
      "Order notes",
      "Comments about your address",
      "Gift message",
      "Coupon code",
      "Card billing address",
      "Address nickname",
      "Phone country code",
    ]) {
      expect(addressPartByName(field("x", label))).toBeNull();
    }
  });
});

describe("the menu inside an address field known only by name or label", () => {
  it("opens on each field of a form that asks for an address, lists and the street's text area too", () => {
    const fields = addressForm();
    const page = createAutofillPageDetailsMock({ fields });
    for (const f of fields) {
      expect([f.opid, isAddressFieldByName(f, page)]).toEqual([f.opid, true]);
    }
    expect(isStreetTextArea(fields[1], page)).toBe(true);
  });

  it("never opens on a search box or a comment field, even in an address form", () => {
    const search = field("q", "Search");
    const typedSearch = field("find", "City", { type: "search" });
    const comments = textArea("comments", "Comments");
    const fields = [...addressForm(), search, typedSearch, comments];
    const page = createAutofillPageDetailsMock({ fields });
    expect(isAddressFieldByName(search, page)).toBe(false);
    expect(isAddressFieldByName(typedSearch, page)).toBe(false);
    expect(isAddressFieldByName(comments, page)).toBe(false);
    expect(isStreetTextArea(comments, page)).toBe(false);
  });

  it("never opens on a lone city box, or a form with fewer than three address parts", () => {
    const city = field("city", "City", { form: null });
    expect(isAddressFieldByName(city, createAutofillPageDetailsMock({ fields: [city] }))).toBe(
      false,
    );
    const locator = [field("city", "City"), field("zip", "ZIP code")];
    const page = createAutofillPageDetailsMock({ fields: locator });
    expect(isAddressFieldByName(locator[0], page)).toBe(false);
    expect(addressPartsInForm(locator[0], page)).toEqual(new Set(["city", "postal"]));
  });

  it("counts only the field's own form, and visible fields", () => {
    const own = [field("city", "City"), field("zip", "ZIP code")];
    const other = [
      list("state", "State", { form: "f2" }),
      field("street", "Street", { form: "f2" }),
    ];
    const hidden = field("country", "Country", { type: "hidden", viewable: false });
    const page = createAutofillPageDetailsMock({ fields: [...own, ...other, hidden] });
    expect(isAddressFieldByName(own[0], page)).toBe(false);
  });

  it("counts fields with address autocomplete hints toward the form, but leaves those fields to upstream", () => {
    const hinted = [
      field("a1", "", { autoCompleteType: "address-line1" }),
      field("pc", "", { autoCompleteType: "postal-code" }),
    ];
    const city = field("town", "Town");
    const page = createAutofillPageDetailsMock({ fields: [...hinted, city] });
    expect(isAddressFieldByName(city, page)).toBe(true);
    expect(isAddressFieldByName(hinted[0], page)).toBe(false);
  });

  it("opens on a list only for the state or the country, and a text area only for the street", () => {
    const title = list("title", "Title");
    const cityList = list("citylist", "City");
    const cityArea = textArea("cityarea", "City");
    const fields = [...addressForm(), title, cityList, cityArea];
    const page = createAutofillPageDetailsMock({ fields });
    expect(isAddressFieldByName(title, page)).toBe(false);
    expect(isAddressFieldByName(cityList, page)).toBe(false);
    expect(isAddressFieldByName(cityArea, page)).toBe(false);
    expect(isStreetTextArea(cityArea, page)).toBe(false);
  });

  it("takes a text area with a street autocomplete hint as the street", () => {
    const area = textArea("addr", "", { autoCompleteType: "shipping street-address" });
    const page = createAutofillPageDetailsMock({ fields: [area] });
    expect(isStreetTextArea(area, page)).toBe(true);
    expect(isStreetTextArea(textArea("bio", "", { autoCompleteType: "off" }), page)).toBe(false);
  });

  it("reads text beside a field only when nothing labels it", () => {
    const unlabelled = [
      field("f-a", "", { "label-left": "Street" }),
      field("f-b", "", { "label-left": "City" }),
      field("f-c", "", { "label-left": "Postcode" }),
    ];
    const page = createAutofillPageDetailsMock({ fields: unlabelled });
    expect(isAddressFieldByName(unlabelled[0], page)).toBe(true);
    const labelled = field("f-d", "Floor", { "label-left": "City" });
    expect(addressPartByName(labelled)).toBeNull();
  });
});
