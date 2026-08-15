import { BadRequestException } from '@nestjs/common';

/**
 * Validates a Date of Birth string (YYYY-MM-DD), ensuring:
 * 1. String is provided and non-empty.
 * 2. Formatted as YYYY-MM-DD with valid integer components.
 * 3. Year is between 1950 and current year.
 * 4. Real calendar date (valid leap year, month length).
 * 5. Date is not in the future.
 * 6. User is at least 18 years old.
 * 7. User is under 120 years old.
 *
 * @param birthdayStr Date string in 'YYYY-MM-DD' format
 */
export function validateBirthday(birthdayStr: string): void {
  if (!birthdayStr || typeof birthdayStr !== 'string' || birthdayStr.trim() === '') {
    throw new BadRequestException('Date of birth is required.');
  }

  const parts = birthdayStr.trim().split('-');
  if (parts.length !== 3) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  if (isNaN(y) || isNaN(m) || isNaN(d)) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const currentYear = new Date().getFullYear();
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > currentYear) {
    throw new BadRequestException(`Year of birth must be between 1950 and ${currentYear}.`);
  }

  const dateObj = new Date(y, m - 1, d);
  if (dateObj.getFullYear() !== y || dateObj.getMonth() !== m - 1 || dateObj.getDate() !== d) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dateObj.setHours(0, 0, 0, 0);

  if (dateObj > today) {
    throw new BadRequestException('Date of birth cannot be in the future.');
  }

  const age18Date = new Date(y + 18, m - 1, d);
  age18Date.setHours(0, 0, 0, 0);
  if (age18Date > today) {
    throw new BadRequestException('You must be at least 18 years old.');
  }

  const age120Date = new Date(y + 120, m - 1, d);
  age120Date.setHours(0, 0, 0, 0);
  if (age120Date < today) {
    throw new BadRequestException('Please enter a valid date of birth.');
  }
}
