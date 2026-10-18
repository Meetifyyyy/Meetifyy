/** `User.gender`, as the API names it. Labels are what people see. */
export const GENDER_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
];

export const GENDER_VALUES = GENDER_OPTIONS.map((o) => o.value);

export const isValidGender = (value) => GENDER_VALUES.includes(value);
