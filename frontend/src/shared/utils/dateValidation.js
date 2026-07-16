/**
 * Validates a Date of Birth (year, month, day) ensuring the user is at least 18 years old locally.
 * 
 * @param {string | number} year 
 * @param {string | number} month (1-12)
 * @param {string | number} day (1-31)
 * @returns {{ isValid: boolean, error: string | null, dobString: string | null }}
 */
export function validateDOB(year, month, day) {
  if (!year || !month || !day) {
    return { isValid: false, error: "Date of birth is required.", dobString: null };
  }

  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);

  if (isNaN(y) || isNaN(m) || isNaN(d)) {
    return { isValid: false, error: "Please enter a valid date.", dobString: null };
  }

  // Basic sanity bounds before using Date object
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) {
    return { isValid: false, error: "Please enter a valid date.", dobString: null };
  }

  // Validate real calendar date (handles leap years and month lengths accurately)
  // Note: month in JS Date is 0-indexed.
  const dateObj = new Date(y, m - 1, d);
  
  if (dateObj.getFullYear() !== y || dateObj.getMonth() !== m - 1 || dateObj.getDate() !== d) {
    return { isValid: false, error: "Please enter a valid date.", dobString: null };
  }

  // Calculate local midnight of current day to avoid timezone off-by-one errors
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Normalize dateObj just in case
  dateObj.setHours(0, 0, 0, 0);

  if (dateObj > today) {
    return { isValid: false, error: "Date of birth cannot be in the future.", dobString: null };
  }

  // Calculate 18th birthday
  // Standard leapling behavior: 2004-02-29 + 18 years = 2022-03-01.
  const age18Date = new Date(y + 18, m - 1, d);
  age18Date.setHours(0, 0, 0, 0);
  
  if (age18Date > today) {
    return { isValid: false, error: "You must be at least 18 years old.", dobString: null };
  }

  // Check upper bound so we don't have 120 year olds (optional sanity check as per prev code)
  const age120Date = new Date(y + 120, m - 1, d);
  if (age120Date < today) {
    return { isValid: false, error: "Please enter a valid date of birth.", dobString: null };
  }

  // Format string for backend
  const dobString = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return { isValid: true, error: null, dobString };
}
