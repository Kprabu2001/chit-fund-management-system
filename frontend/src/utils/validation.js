// Login form validation — keep these rules in sync with validate_login_input() in backend/api/views.py

export const PASSWORD_MIN_LENGTH = 5;
export const PASSWORD_MAX_LENGTH = 128;

// Keeps only digits and caps at 10 (use as the onChange sanitiser for the phone input)
export const sanitizePhoneInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

// Returns an error message, or '' when the phone number is valid
export const validatePhone = (value) => {
  const phone = String(value || '').trim();
  if (!phone) return 'Phone number is required.';
  if (!/^\d+$/.test(phone)) return 'Phone number can contain digits only.';
  if (phone.length !== 10) return 'Phone number must be exactly 10 digits.';
  if (!/^[6-9]/.test(phone)) return 'Phone number must start with 6, 7, 8 or 9.';
  return '';
};

// Returns an error message, or '' when the password is valid
export const validatePassword = (value) => {
  const password = String(value || '');
  if (!password) return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  return '';
};

export const validateLoginForm = (phone, password) => {
  const errors = {};
  const phoneError = validatePhone(phone);
  const passwordError = validatePassword(password);
  if (phoneError) errors.phone = phoneError;
  if (passwordError) errors.password = passwordError;
  return errors;
};