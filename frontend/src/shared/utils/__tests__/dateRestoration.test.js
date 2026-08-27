import { describe, it, expect } from 'vitest';
import { validateDOB } from '../dateValidation';

describe('Birthday form state restoration and formatting', () => {
  it('correctly parses and restores birthday ISO parts for form fields', () => {
    const savedBirthday = '2002-05-15';
    const initialParts = savedBirthday.split('-');
    const initialYear = initialParts[0] || '';
    const initialMonth = initialParts[1] ? String(parseInt(initialParts[1], 10)) : '';
    const initialDay = initialParts[2] ? String(parseInt(initialParts[2], 10)) : '';

    expect(initialYear).toBe('2002');
    expect(initialMonth).toBe('5');
    expect(initialDay).toBe('15');

    // Matches Month dropdown option value (numbers 1-12 or string numbers)
    const options = Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: new Date(0, i).toLocaleString('default', { month: 'short' }),
    }));

    const isOptionSelected = (opt, value) =>
      String(opt.value) === String(value) ||
      (!isNaN(Number(opt.value)) &&
        !isNaN(Number(value)) &&
        Number(opt.value) === Number(value) &&
        String(value).trim() !== '');

    const selectedOption = options.find((opt) => isOptionSelected(opt, initialMonth));
    expect(selectedOption).toBeDefined();
    expect(selectedOption.label).toBe('May');
  });

  it('handles single digit month and day correctly across forward/back navigation cycles', () => {
    // 1. User submits Month 3 (March), Day 5, Year 1999
    const validation = validateDOB('1999', '3', '5');
    expect(validation.isValid).toBe(true);
    expect(validation.dobString).toBe('1999-03-05');

    // 2. User moves to Step 2, then navigates back to Step 1
    const restoredParts = validation.dobString.split('-');
    const restoredYear = restoredParts[0] || '';
    const restoredMonth = restoredParts[1] ? String(parseInt(restoredParts[1], 10)) : '';
    const restoredDay = restoredParts[2] ? String(parseInt(restoredParts[2], 10)) : '';

    expect(restoredYear).toBe('1999');
    expect(restoredMonth).toBe('3');
    expect(restoredDay).toBe('5');

    // 3. User navigates forward again without re-typing
    const reValidation = validateDOB(restoredYear, restoredMonth, restoredDay);
    expect(reValidation.isValid).toBe(true);
    expect(reValidation.dobString).toBe('1999-03-05');
  });

  it('handles empty birthday without crashing', () => {
    const emptyDob = '';
    const initialParts = emptyDob ? emptyDob.split('-') : ['', '', ''];
    const initialYear = initialParts[0] || '';
    const initialMonth = initialParts[1] ? String(parseInt(initialParts[1], 10)) : '';
    const initialDay = initialParts[2] ? String(parseInt(initialParts[2], 10)) : '';

    expect(initialYear).toBe('');
    expect(initialMonth).toBe('');
    expect(initialDay).toBe('');
  });
});
