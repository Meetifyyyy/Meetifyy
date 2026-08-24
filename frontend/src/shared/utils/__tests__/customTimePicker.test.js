import { describe, it, expect } from 'vitest';
import { parseTime, EMPTY_TIME } from '../../components/ui/CustomTimePicker';

describe('CustomTimePicker — empty state', () => {
  it('selects nothing when there is no value', () => {
    // This is the whole bug: the empty case used to return 10:00 AM, and the
    // columns highlight whatever it returns. So a Create Event modal the user
    // had never touched opened with an hour, a minute and a meridiem all
    // looking chosen, while the field beside it still read "--:-- --".
    expect(parseTime('')).toEqual(EMPTY_TIME);
    expect(parseTime(null)).toEqual(EMPTY_TIME);
    expect(parseTime(undefined)).toEqual(EMPTY_TIME);
  });

  it('selects nothing for a value it cannot parse', () => {
    expect(parseTime('not-a-time')).toEqual(EMPTY_TIME);
    expect(parseTime(':30')).toEqual(EMPTY_TIME);
  });

  it('still parses a real value into the three columns', () => {
    expect(parseTime('10:00')).toEqual({ hour12: '10', minute: '00', ampm: 'AM' });
    expect(parseTime('13:30')).toEqual({ hour12: '01', minute: '30', ampm: 'PM' });
    expect(parseTime('00:15')).toEqual({ hour12: '12', minute: '15', ampm: 'AM' });
    expect(parseTime('12:45')).toEqual({ hour12: '12', minute: '45', ampm: 'PM' });
  });

  it('snaps an off-grid minute to the nearest quarter the column offers', () => {
    expect(parseTime('09:10').minute).toBe('15');
    expect(parseTime('09:25').minute).toBe('30');
    expect(parseTime('09:59').minute).toBe('00');
  });
});
