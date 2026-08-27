const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Checks if a year is a leap year.
 */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Validates a Date of Birth (year, month, day) ensuring the user is at least 18 years old locally.
 * 
 * @param {string | number} year 
 * @param {string | number} month (1-12)
 * @param {string | number} day (1-31)
 * @returns {{ isValid: boolean, error: string | null, dobString: string | null }}
 */
export function validateDOB(year, month, day) {
  if (
    year === undefined || year === null || String(year).trim() === '' ||
    month === undefined || month === null || String(month).trim() === '' ||
    day === undefined || day === null || String(day).trim() === ''
  ) {
    return { isValid: false, error: "Date of birth is required.", dobString: null };
  }

  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);

  if (isNaN(y) || isNaN(m) || isNaN(d)) {
    return { isValid: false, error: "Please enter a valid date.", dobString: null };
  }

  if (m < 1 || m > 12) {
    return { isValid: false, error: "Please select a valid month.", dobString: null };
  }

  if (d < 1 || d > 31) {
    return { isValid: false, error: "Day must be between 1 and 31.", dobString: null };
  }

  if (y < 1950) {
    return { isValid: false, error: "Please enter a valid date of birth.", dobString: null };
  }

  // Month-specific days validation (handles 30-day months, February, and leap years)
  if (m === 2) {
    const leap = isLeapYear(y);
    if (leap && d > 29) {
      return { isValid: false, error: "February has only 29 days.", dobString: null };
    }
    if (!leap && d === 29) {
      return { isValid: false, error: `February has only 28 days in ${y}.`, dobString: null };
    }
    if (!leap && d > 28) {
      return { isValid: false, error: "February has only 28 days.", dobString: null };
    }
  } else if ([4, 6, 9, 11].includes(m)) {
    if (d > 30) {
      const monthName = MONTH_NAMES[m - 1];
      return { isValid: false, error: `${monthName} has only 30 days.`, dobString: null };
    }
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
    return { isValid: false, error: "You must be at least 18 years old.", dobString: null };
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
  age120Date.setHours(0, 0, 0, 0);
  if (age120Date < today) {
    return { isValid: false, error: "Please enter a valid date of birth.", dobString: null };
  }

  // Format string for backend
  const dobString = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return { isValid: true, error: null, dobString };
}
