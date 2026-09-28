import { Directive, ElementRef, OnDestroy, OnInit, Renderer2, inject } from '@angular/core';

/**
 * "Olhinho" para mostrar/ocultar a senha. Use no próprio input:
 * `<input pInputText type="password" jfPasswordToggle ... />`.
 * Envolve o input e põe o botão por cima, à direita; funciona com qualquer
 * forma de binding (formControlName, ngModel) porque só troca o `type`.
 */
@Directive({
  selector: 'input[jfPasswordToggle]',
  standalone: true,
})
export class PasswordToggleDirective implements OnInit, OnDestroy {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);
  private button: HTMLButtonElement | null = null;
  private visible = false;
  private unlisten: (() => void) | null = null;

  ngOnInit(): void {
    const parent = this.input.parentNode;
    if (!parent) return;
    const wrapper = this.renderer.createElement('span') as HTMLSpanElement;
    this.renderer.addClass(wrapper, 'jf-password');
    this.renderer.insertBefore(parent, wrapper, this.input);
    this.renderer.appendChild(wrapper, this.input);

    const button = this.renderer.createElement('button') as HTMLButtonElement;
    this.renderer.setAttribute(button, 'type', 'button');
    this.renderer.addClass(button, 'jf-password__toggle');
    const icon = this.renderer.createElement('i') as HTMLElement;
    this.renderer.setAttribute(icon, 'aria-hidden', 'true');
    this.renderer.appendChild(button, icon);
    this.renderer.appendChild(wrapper, button);
    this.button = button;
    this.unlisten = this.renderer.listen(button, 'click', () => this.toggle());
    this.render();
    // A tela pode limitar a largura do input (ex.: max-width no Perfil): o
    // envoltório herda o limite, senão o olho ficaria fora do campo.
    requestAnimationFrame(() => {
      const maxWidth = getComputedStyle(this.input).maxWidth;
      if (maxWidth && maxWidth !== 'none') {
        this.renderer.setStyle(wrapper, 'max-width', maxWidth);
        this.renderer.setStyle(this.input, 'max-width', 'none');
      }
    });
  }

  ngOnDestroy(): void {
    this.unlisten?.();
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.render();
    this.input.focus();
  }

  private render(): void {
    this.renderer.setAttribute(this.input, 'type', this.visible ? 'text' : 'password');
    if (!this.button) return;
    const label = this.visible ? 'Ocultar senha' : 'Mostrar senha';
    this.renderer.setAttribute(this.button, 'aria-label', label);
    this.renderer.setAttribute(this.button, 'title', label);
    this.renderer.setAttribute(this.button, 'aria-pressed', String(this.visible));
    const icon = this.button.firstElementChild;
    if (icon) icon.className = this.visible ? 'pi pi-eye-slash' : 'pi pi-eye';
  }
}
