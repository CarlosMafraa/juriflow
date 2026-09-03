import {
  ChangeDetectionStrategy,
  Component,
  Input,
  booleanAttribute,
  forwardRef,
  signal,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

let uid = 0;

@Component({
  selector: 'jf-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InputComponent), multi: true },
  ],
  template: `
    <label class="field">
      @if (label) {
        <span class="field__label"
          >{{ label }}
          @if (required) {
            <span aria-hidden="true"> *</span>
          }
        </span>
      }
      <input
        class="field__control"
        [class.field__control--invalid]="!!error"
        [id]="id"
        [type]="type"
        [attr.placeholder]="placeholder || null"
        [attr.autocomplete]="autocomplete || null"
        [disabled]="disabled()"
        [value]="value()"
        [attr.aria-invalid]="!!error || null"
        [attr.aria-describedby]="error ? id + '-err' : hint ? id + '-hint' : null"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
      @if (error) {
        <span class="field__msg field__msg--error" [id]="id + '-err'">{{ error }}</span>
      } @else if (hint) {
        <span class="field__msg" [id]="id + '-hint'">{{ hint }}</span>
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
        color: var(--jf-text, #0f172a);
      }
      .field__control {
        font: inherit;
        padding: 0.55rem 0.75rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
        background: var(--jf-surface, #fff);
        color: var(--jf-text, #0f172a);
        width: 100%;
      }
      .field__control:focus-visible {
        outline: 2px solid var(--jf-primary, #2563eb);
        outline-offset: 1px;
      }
      .field__control:disabled {
        background: var(--jf-surface-muted, #f1f5f9);
        opacity: 0.7;
      }
      .field__control--invalid {
        border-color: var(--jf-danger, #dc2626);
      }
      .field__msg {
        font-size: 0.75rem;
        color: var(--jf-text-muted, #64748b);
      }
      .field__msg--error {
        color: var(--jf-danger, #dc2626);
      }
    `,
  ],
})
export class InputComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() type: 'text' | 'email' | 'password' | 'tel' | 'number' | 'date' = 'text';
  @Input() placeholder = '';
  @Input() hint = '';
  @Input() error = '';
  @Input({ transform: booleanAttribute }) required = false;
  @Input() autocomplete = '';
  @Input() id = `jf-input-${++uid}`;

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

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
  }
}
