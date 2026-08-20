// Password policy shared by user creation and password change.

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 10;

// Small embedded list of the most common passwords/patterns (lowercased).
const COMMON_PASSWORDS = new Set([
  "1234567890", "0123456789", "password12", "password123", "passw0rd12",
  "qwertyuiop", "1q2w3e4r5t", "iloveyou12", "welcome123", "abc1234567",
  "admin12345", "letmein123", "sunshine12", "football12", "monkey12345",
  "dragon12345", "master12345", "shadow12345", "superman12", "michael123",
  "constructionerp", "construction1", "builder12345", "engineer123",
  "india123456", "mumbai12345", "delhi123456", "pune1234567",
]);

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 100) return "Password too long";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That password is too common — pick another";
  if (/^(.)\1+$/.test(password)) return "Password cannot be one repeated character";
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower)) {
    return "Password cannot be a simple sequence";
  }
  return null;
}
