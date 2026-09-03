import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { AuthLayoutComponent } from './auth-layout.component';

function configure(isDesktop: boolean) {
  TestBed.configureTestingModule({
    imports: [AuthLayoutComponent],
    providers: [
      provideRouter([]),
      {
        provide: BreakpointObserver,
        useValue: { observe: () => of({ matches: isDesktop, breakpoints: {} }) },
      },
      { provide: AuthService, useValue: { signOut: () => Promise.resolve() } },
      {
        provide: ActiveSpaceService,
        useValue: {
          availableSpaces: signal([]),
          activeSpaceId: signal<string | null>(null),
          setActiveSpace: () => undefined,
        },
      },
      { provide: PermissionService, useValue: { can: () => false } },
    ],
  });
}

describe('AuthLayoutComponent (responsivo)', () => {
  it('no mobile/tablet mostra o botão de menu e a gaveta começa fechada', () => {
    configure(false);
    const fixture = TestBed.createComponent(AuthLayoutComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component['isDesktop']()).toBe(false);
    expect(component['drawerOpen']()).toBe(false);

    const toggle = fixture.nativeElement.querySelector('.topbar__toggle');
    expect(toggle).toBeTruthy();

    component['toggleDrawer']();
    fixture.detectChanges();
    expect(component['drawerOpen']()).toBe(true);
    expect(fixture.nativeElement.querySelector('.drawer--overlay')).toBeTruthy();
  });

  it('no desktop a sidebar é fixa e não há botão de menu', () => {
    configure(true);
    const fixture = TestBed.createComponent(AuthLayoutComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance['isDesktop']()).toBe(true);
    expect(fixture.nativeElement.querySelector('.topbar__toggle')).toBeNull();
    expect(fixture.nativeElement.querySelector('.drawer')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.drawer--overlay')).toBeNull();
  });
});
