import { Validators, type ValidatorFn } from '@angular/forms';

/**
 * Espelho da política do Supabase Auth (`minimum_password_length = 8`,
 * `password_requirements = "letters_digits"` no config.toml — no Cloud, o
 * mesmo em Authentication → Policies). O Auth é quem garante; aqui é só para
 * o usuário saber o motivo antes de enviar.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_HINT = 'Mínimo de 8 caracteres, com letras e números.';

export const passwordValidators: ValidatorFn[] = [
  Validators.required,
  Validators.minLength(PASSWORD_MIN_LENGTH),
  Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/),
];
