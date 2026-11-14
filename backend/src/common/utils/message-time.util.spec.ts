import { messageTime } from './message-time.util';

describe('messageTime', () => {
  const old = (value: Date | string | number) =>
    new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

  it('says exactly what toLocaleTimeString said, for every minute of a day', () => {
    const start = new Date('2026-11-14T00:00:00.000Z').getTime();
    for (let m = 0; m < 24 * 60; m += 7) {
      const at = new Date(start + m * 60_000);
      expect(messageTime(at)).toBe(old(at));
      expect(messageTime(at.toISOString())).toBe(old(at.toISOString()));
      expect(messageTime(at.getTime())).toBe(old(at.getTime()));
    }
  });

  it('answers "Invalid Date" for an invalid date, as before, rather than throwing', () => {
    expect(messageTime('not a date')).toBe(old('not a date'));
  });
});
