import { ChangeDetectionStrategy, Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormControl, ReactiveFormsModule } from "@angular/forms";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  FOLDER_ICONS,
  FOLDER_TONES,
  FolderLook,
} from "@bitwarden/common/vault/keykeeper/folder-looks";

import { KeykeeperFolderLookPickerComponent } from "./folder-look-picker.component";

const WORDS: Record<string, string> = {
  keykeeperFolderLookPlain: "Plain folder",
  keykeeperFolderLookIcon: "Icon",
  keykeeperFolderLookColor: "Color",
  keykeeperFolderLookPreview: "How it shows in the menu",
  keykeeperFolderLookUnnamed: "This shared folder",
  keykeeperFolderLookHint: "Everyone who has this folder sees its icon.",
};

@Component({
  template: `<vault-keykeeper-folder-look-picker [formControl]="look" [name]="name" />`,
  imports: [ReactiveFormsModule, KeykeeperFolderLookPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  look = new FormControl<FolderLook | null>(null);
  name = "Banking";
}

describe("KeykeeperFolderLookPickerComponent", () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: I18nService, useValue: { t: (key: string) => WORDS[key] ?? key } }],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const icons = () => [...root().querySelectorAll<HTMLButtonElement>('[data-kk="icon"]')];
  const tones = () => [...root().querySelectorAll<HTMLButtonElement>('[data-kk="tone"]')];
  const icon = (id: string) => root().querySelector<HTMLButtonElement>(`[data-icon="${id}"]`)!;
  const tone = (id: string) => root().querySelector<HTMLButtonElement>(`[data-tone="${id}"]`)!;
  const checked = (buttons: HTMLButtonElement[]) =>
    buttons
      .filter((b) => b.getAttribute("aria-checked") === "true")
      .map((b) => b.getAttribute("aria-label"));
  const press = (button: HTMLButtonElement, key: string) => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  const tile = () => root().querySelector("vault-keykeeper-category-tile");

  it("starts as the plain folder: its glyph in the preview, no icon or color picked", () => {
    expect(root().querySelector('[data-kk="plain"]')).not.toBeNull();
    expect(tile()).toBeNull();
    expect(root().textContent).toContain("Banking");
    expect(root().textContent).toContain("How it shows in the menu");
    expect(checked(icons())).toEqual(["Plain folder"]);
    expect(checked(tones())).toEqual([]);
  });

  it("names every choice in plain words, in two labelled groups of radio buttons", () => {
    const groups = [...root().querySelectorAll('[role="radiogroup"]')];
    expect(
      groups.map((g) =>
        root()
          .querySelector(`#${g.getAttribute("aria-labelledby")}`)
          ?.textContent?.trim(),
      ),
    ).toEqual(["Icon", "Color"]);
    expect(icons().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Plain folder",
      ...FOLDER_ICONS.map((i) => i.label),
    ]);
    expect(tones().map((b) => b.getAttribute("aria-label"))).toEqual(
      FOLDER_TONES.map((t) => t.label),
    );
    expect([...icons(), ...tones()].every((b) => b.getAttribute("role") === "radio")).toBe(true);
  });

  it("picks an icon in the first color, then a color for it, and previews the tile", () => {
    icon("bank").click();
    fixture.detectChanges();
    expect(host.look.value).toEqual({ icon: "bank", tone: "sapphire" });
    expect(host.look.dirty || host.look.touched).toBe(true);

    tone("emerald").click();
    fixture.detectChanges();
    expect(host.look.value).toEqual({ icon: "bank", tone: "emerald" });
    expect(checked(icons())).toEqual(["Bank"]);
    expect(checked(tones())).toEqual(["Green"]);
    expect(tile()).not.toBeNull();
    expect(root().querySelector('[data-kk="plain"]')).toBeNull();
  });

  it("gives the folder glyph a color when a color comes first, and Plain folder takes the look away", () => {
    tone("garnet").click();
    fixture.detectChanges();
    expect(host.look.value).toEqual({ icon: "folder", tone: "garnet" });

    icon("plain").click();
    fixture.detectChanges();
    expect(host.look.value).toBeNull();
    expect(tile()).toBeNull();
  });

  it("shows a look it's given", () => {
    host.look.setValue({ icon: "server", tone: "garnet" });
    fixture.detectChanges();
    expect(checked(icons())).toEqual(["Server"]);
    expect(checked(tones())).toEqual(["Red"]);
    expect(tile()).not.toBeNull();
  });

  it("is one Tab stop per group, on what's picked, and arrow keys move and pick", () => {
    const stops = () =>
      [...icons(), ...tones()]
        .filter((b) => b.tabIndex === 0)
        .map((b) => b.getAttribute("aria-label"));
    expect(stops()).toEqual(["Plain folder", "Blue"]);

    press(icon("plain"), "ArrowRight");
    expect(host.look.value).toEqual({ icon: "folder", tone: "sapphire" });
    expect(document.activeElement).toBe(icon("folder"));
    expect(stops()).toEqual(["Folder", "Blue"]);

    press(icon("folder"), "ArrowDown");
    expect(host.look.value?.icon).toBe("people");

    press(icon("people"), "End");
    expect(host.look.value?.icon).toBe(FOLDER_ICONS[FOLDER_ICONS.length - 1].id);
    press(icon(FOLDER_ICONS[FOLDER_ICONS.length - 1].id), "ArrowRight");
    // Past the end, back to the start: the plain folder.
    expect(host.look.value).toBeNull();
    press(icon("plain"), "ArrowLeft");
    expect(host.look.value?.icon).toBe(FOLDER_ICONS[FOLDER_ICONS.length - 1].id);

    press(tone("sapphire"), "ArrowRight");
    expect(host.look.value?.tone).toBe("aquamarine");
    expect(document.activeElement).toBe(tone("aquamarine"));
    press(tone("aquamarine"), "Home");
    expect(host.look.value?.tone).toBe("sapphire");
    press(tone("sapphire"), "ArrowUp");
    expect(host.look.value?.tone).toBe("onyx");
    expect(stops()).toEqual([FOLDER_ICONS[FOLDER_ICONS.length - 1].label, "Gray"]);

    // Other keys are left alone.
    const before = host.look.value;
    press(tone("onyx"), "a");
    expect(host.look.value).toBe(before);
  });

  it("can't be changed while disabled, as for someone who can't rename the folder", () => {
    host.look.disable();
    fixture.detectChanges();
    expect([...icons(), ...tones()].every((b) => b.disabled)).toBe(true);
  });
});
