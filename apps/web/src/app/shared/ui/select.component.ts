import { ChangeDetectionStrategy, Component, Input, forwardRef, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

export interface SelectOption {
  value: string;
  label: string;
}

let uid = 0;

@Component({
  selector: 'jf-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true },
  ],
  template: `
    <label class="field">
      @if (label) {
        <span class="field__label">{{ label }}</span>
      }
      <select
        class="field__control"
        [id]="id"
        [disabled]="disabled()"
        [value]="value()"
        [attr.aria-invalid]="!!error || null"
        (change)="onSelect($event)"
        (blur)="onTouched()"
      >
        @if (placeholder) {
          <option value="" disabled>{{ placeholder }}</option>
        }
        @for (opt of options; track opt.value) {
          <option [value]="opt.value">{{ opt.label }}</option>
        }
      </select>
      @if (error) {
        <span class="field__msg field__msg--error">{{ error }}</span>
      }
    </label>
  `,
  styles: [
    `
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .field__label {
        font-size: 0.8125rem;
        font-weight: 600;
      }
      .field__control {
        font: inherit;
        padding: 0.55rem 0.75rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
        background: var(--jf-surface, #fff);
        width: 100%;
      }
      .field__control:focus-visible {
        outline: 2px solid var(--jf-primary, #2563eb);
        outline-offset: 1px;
      }
      .field__msg--error {
        font-size: 0.75rem;
        color: var(--jf-danger, #dc2626);
      }
    `,
  ],
})
export class SelectComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() placeholder = '';
  @Input() error = '';
  @Input() options: SelectOption[] = [];
  @Input() id = `jf-select-${++uid}`;

  protected readonly value = signal<string>('');
  protected readonly disabled = signal<boolean>(false);

  private onChange: (v: string) => void = () => {};
  protected onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onSelect(event: Event): void {
    const next = (event.target as HTMLSelectElement).value;
    this.value.set(next);
    this.onChange(next);
  }
}
