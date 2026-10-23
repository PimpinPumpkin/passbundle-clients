import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute } from "@angular/router";
import { of } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { HeaderComponent, IconButtonModule, SideNavService } from "@bitwarden/components";

import { KEYKEEPER_MENU_BUTTON } from "../../keykeeper/vault-menu/menu-button";

import { WebHeaderComponent } from "./web-header.component";

@Component({
  selector: "product-switcher",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProductSwitcherStubComponent {}

@Component({
  selector: "app-account-menu",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class AccountMenuStubComponent {}

describe("WebHeaderComponent", () => {
  const sideNav = { open: signal(false), toggle: jest.fn() };

  async function render(menuButton?: boolean) {
    await TestBed.configureTestingModule({
      imports: [WebHeaderComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ titleId: "vaults" }) } },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: SideNavService, useValue: sideNav },
        ...(menuButton == null ? [] : [{ provide: KEYKEEPER_MENU_BUTTON, useValue: menuButton }]),
      ],
    })
      .overrideComponent(WebHeaderComponent, {
        set: {
          imports: [
            CommonModule,
            JslibModule,
            HeaderComponent,
            IconButtonModule,
            ProductSwitcherStubComponent,
            AccountMenuStubComponent,
          ],
        },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(WebHeaderComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const menuButton = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>("button[aria-label=keykeeperMenu]");

  it("has a menu button before the title where the layout asks for one", async () => {
    const el = await render(true);
    const button = menuButton(el)!;

    expect(button.compareDocumentPosition(el.querySelector("h1")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(button.getAttribute("aria-controls")).toBe("bit-side-nav");
    button.click();
    expect(sideNav.toggle).toHaveBeenCalled();
  });

  it("lets the menu's product switcher stand in for its own on a phone", async () => {
    const el = await render(true);

    expect(el.querySelector("product-switcher")!.classList).toContain("keykeeper-phone-hidden");
  });

  it("has none in other layouts, such as the admin console", async () => {
    const el = await render();

    expect(menuButton(el)).toBeNull();
    expect(el.querySelector("product-switcher")!.classList).not.toContain("keykeeper-phone-hidden");
  });
});
