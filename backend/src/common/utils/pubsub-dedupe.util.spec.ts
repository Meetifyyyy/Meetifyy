import { SeenMessageIds, newMessageId } from './pubsub-dedupe.util';

describe('SeenMessageIds', () => {
  it('reports the first sighting of an id and rejects repeats', () => {
    const seen = new SeenMessageIds();
    expect(seen.firstSighting('a')).toBe(true);
    expect(seen.firstSighting('a')).toBe(false);
    expect(seen.firstSighting('b')).toBe(true);
  });

  it('forgets an id after its window, so memory stays bounded', () => {
    jest.useFakeTimers();
    try {
      const seen = new SeenMessageIds();
      seen.firstSighting('a');
      jest.advanceTimersByTime(5 * 60_000 + 1);
      expect(seen.firstSighting('a')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('newMessageId', () => {
  it('is unique per call', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newMessageId()));
    expect(ids.size).toBe(1000);
  });
});
