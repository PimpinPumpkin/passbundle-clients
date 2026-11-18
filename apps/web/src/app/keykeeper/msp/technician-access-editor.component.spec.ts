import { ComponentFixture, TestBed } from "@angular/core/testing";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { TechnicianAccess } from "./msp-api.service";
import { DEFAULT_ACCESS } from "./technician-access";
import { KeykeeperTechnicianAccessEditorComponent } from "./technician-access-editor.component";

const clients = [
  { id: "acme", name: "Acme Dental" },
  { id: "baker", name: "Baker Law" },
];

describe("KeykeeperTechnicianAccessEditorComponent", () => {
  let fixture: ComponentFixture<KeykeeperTechnicianAccessEditorComponent>;
  let emitted: TechnicianAccess[];

  async function render(access?: TechnicianAccess) {
    await TestBed.configureTestingModule({
      imports: [KeykeeperTechnicianAccessEditorComponent],
      providers: [{ provide: I18nService, useValue: { t: (key: string) => key } }],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperTechnicianAccessEditorComponent);
    fixture.componentRef.setInput("clients", clients);
    if (access != null) {
      fixture.componentRef.setInput("access", access);
    }
    emitted = [];
    fixture.componentInstance.accessChange.subscribe((a) => emitted.push(a));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const checkbox = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      `input[formcontrolname="${name}"]`,
    )!;

  async function click(name: string) {
    checkbox(name).click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it("offers script access, off unless chosen, with what it means", async () => {
    await render();
    expect(checkbox("scriptAccess").checked).toBe(false);
    const label = checkbox("scriptAccess").closest("bit-form-control")!.textContent!;
    expect(label.replace(/\s+/g, " ")).toContain(
      "Makes, sees, and revokes script tokens in the clients they reach where they're an admin.",
    );

    await click("scriptAccess");
    expect(emitted.at(-1)).toEqual({ ...DEFAULT_ACCESS, scriptAccess: true, clientRoles: [] });
    await click("scriptAccess");
    expect(emitted.at(-1)!.scriptAccess).toBe(false);
  });

  it("starts from the technician's script access and keeps it through other changes", async () => {
    await render({ ...DEFAULT_ACCESS, installCommands: true, scriptAccess: true });
    expect(checkbox("scriptAccess").checked).toBe(true);
    await click("installCommands");
    expect(emitted.at(-1)).toMatchObject({ installCommands: false, scriptAccess: true });
  });

  it("reads access from an older server, which leaves script access out, as none", async () => {
    const older: TechnicianAccess = {
      allClients: true,
      clients: [],
      custom: null,
      installCommands: true,
    };
    await render(older);
    expect(checkbox("scriptAccess").checked).toBe(false);
    await click("installCommands");
    expect(emitted.at(-1)!.scriptAccess).toBe(false);
  });
});
