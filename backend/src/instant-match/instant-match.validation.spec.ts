import { BadRequestException } from '@nestjs/common';
import {
  parseJoinQueuePayload,
  parseMatchRespondPayload,
  readQueueSnapshot,
  toQueueSnapshot,
} from './dto/join-queue.dto';

/**
 * The socket boundary is the only place untrusted Instant Match input enters
 * the system. These cases pin the contract the UI must satisfy — and, more
 * importantly, what happens when something that is not the UI calls in.
 */
describe('Instant Match payload validation', () => {
  const valid = {
    campus: 'GLA University',
    activity: 'study',
    timePreference: 'now',
    optionalDetail: 'Physics',
    location: { area: 'library', gps: { latitude: 27.6, longitude: 77.6 } },
  };

  describe('queue:join', () => {
    it('normalises a well-formed payload', () => {
      const dto = parseJoinQueuePayload('u1', valid);
      expect(dto).toEqual({
        userId: 'u1',
        campus: 'GLA University',
        activity: 'study',
        timePreference: 'now',
        optionalDetail: 'Physics',
        area: 'library',
        gps: { latitude: 27.6, longitude: 77.6 },
      });
    });

    it.each([null, undefined, 'nope', 42])('rejects a non-object body (%p)', (body) => {
      expect(() => parseJoinQueuePayload('u1', body)).toThrow(BadRequestException);
    });

    it('rejects an activity outside the allow-list', () => {
      expect(() => parseJoinQueuePayload('u1', { ...valid, activity: 'skydiving' }))
        .toThrow('Pick an activity to continue');
    });

    it('rejects a missing activity rather than writing an empty bucket', () => {
      const { activity: _drop, ...rest } = valid;
      expect(() => parseJoinQueuePayload('u1', rest)).toThrow(BadRequestException);
    });

    it('rejects a time preference outside the allow-list', () => {
      expect(() => parseJoinQueuePayload('u1', { ...valid, timePreference: 'someday' }))
        .toThrow('Pick when you want to meet');
    });

    it('rejects a blank campus', () => {
      expect(() => parseJoinQueuePayload('u1', { ...valid, campus: '   ' }))
        .toThrow(BadRequestException);
    });

    it('rejects an unknown campus area', () => {
      expect(() =>
        parseJoinQueuePayload('u1', { ...valid, location: { area: 'rooftop' } }),
      ).toThrow('Unknown campus area');
    });

    it('truncates an over-long optional detail instead of failing the join', () => {
      const dto = parseJoinQueuePayload('u1', { ...valid, optionalDetail: 'x'.repeat(500) });
      expect(dto.optionalDetail).toHaveLength(60);
    });

    it('treats a whitespace-only detail as absent', () => {
      expect(parseJoinQueuePayload('u1', { ...valid, optionalDetail: '   ' }).optionalDetail)
        .toBeNull();
    });

    it('degrades gracefully when location is missing entirely', () => {
      const { location: _drop, ...rest } = valid;
      const dto = parseJoinQueuePayload('u1', rest);
      expect(dto.area).toBeNull();
      expect(dto.gps).toBeNull();
    });

    it.each([
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: 'north', longitude: 0 },
      { latitude: NaN, longitude: 0 },
      { latitude: Infinity, longitude: 0 },
    ])('rejects out-of-range or non-numeric coordinates (%p)', (gps) => {
      expect(() => parseJoinQueuePayload('u1', { ...valid, location: { gps } }))
        .toThrow('Invalid coordinates');
    });

    it('always takes the userId from the authenticated socket, never the body', () => {
      const dto = parseJoinQueuePayload('u1', { ...valid, userId: 'someone-else' });
      expect(dto.userId).toBe('u1');
    });
  });

  describe('match:respond', () => {
    it('accepts both valid actions', () => {
      expect(parseMatchRespondPayload({ matchId: 'm1', action: 'accept' }))
        .toEqual({ matchId: 'm1', action: 'accept' });
      expect(parseMatchRespondPayload({ matchId: 'm1', action: 'decline' }))
        .toEqual({ matchId: 'm1', action: 'decline' });
    });

    it.each(['maybe', '', null, 1])('rejects action %p', (action) => {
      expect(() => parseMatchRespondPayload({ matchId: 'm1', action }))
        .toThrow(BadRequestException);
    });

    it('rejects a missing match id', () => {
      expect(() => parseMatchRespondPayload({ action: 'accept' }))
        .toThrow('Missing match id');
    });
  });

  describe('queue snapshots', () => {
    it('round-trips a full request', () => {
      const dto = parseJoinQueuePayload('u1', valid);
      expect(readQueueSnapshot(toQueueSnapshot(dto))).toEqual({
        campus: 'GLA University',
        activity: 'study',
        timePreference: 'now',
        optionalDetail: 'Physics',
        area: 'library',
        gps: { latitude: 27.6, longitude: 77.6 },
      });
    });

    it.each([null, undefined, {}, { activity: 'study' }, 'garbage'])(
      'returns null for an unusable stored snapshot (%p) so re-queue is skipped, not crashed',
      (stored) => {
        expect(readQueueSnapshot(stored)).toBeNull();
      },
    );

    it('drops a partial gps block rather than persisting half a coordinate', () => {
      const snap = readQueueSnapshot({
        campus: 'C', activity: 'walk', timePreference: 'now',
        optionalDetail: null, area: null, gps: { latitude: 1 },
      });
      expect(snap?.gps).toBeNull();
    });
  });
});
