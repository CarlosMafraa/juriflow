import { ChangeDetectionStrategy, Component, Input, booleanAttribute } from '@angular/core';

@Component({
  selector: 'jf-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="spinner"
      [style.width.px]="size"
      [style.height.px]="size"
      role="status"
      [attr.aria-label]="label"
    ></span>
    @if (label && showLabel) {
      <span class="spinner__label">{{ label }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .spinner {
        display: inline-block;
        border: 2px solid var(--jf-border, #cbd5e1);
        border-right-color: var(--jf-primary, #2563eb);
        border-radius: 50%;
        animation: jf-spin 0.7s linear infinite;
      }
      .spinner__label {
        font-size: 0.8125rem;
        color: var(--jf-text-muted, #64748b);
      }
      @keyframes jf-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class SpinnerComponent {
  @Input() size = 20;
  @Input() label = 'Carregando…';
  @Input({ transform: booleanAttribute }) showLabel = false;
}
