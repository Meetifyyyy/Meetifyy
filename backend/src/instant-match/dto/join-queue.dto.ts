import { BadRequestException } from '@nestjs/common';
import {
  MATCH_ACTIVITIES,
  TIME_PREFERENCES,
  CAMPUS_AREAS,
  OPTIONAL_DETAIL_MAX,
  CAMPUS_MAX,
} from '../instant-match.constants';

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

export interface JoinQueueDto {
  userId: string;
  campus: string;
  activity: string;
  timePreference: string;
  optionalDetail: string | null;
  area: string | null;
  gps: GpsPoint | null;
}

/** The subset of a JoinQueueDto that can be replayed to re-queue a user
 *  after a match falls through. Persisted on the MatchSession. */
export type QueueSnapshot = Omit<JoinQueueDto, 'userId'>;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates and normalises an untrusted `queue:join` socket payload.
 *
 * Throws BadRequestException with a field-specific message so the client
 * can point the user at the step that needs fixing, rather than failing
 * anonymously deeper down in Prisma.
 */
export function parseJoinQueuePayload(userId: string, raw: any): JoinQueueDto {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException('Malformed request');
  }

  const activity = typeof raw.activity === 'string' ? raw.activity.trim() : '';
  if (!(MATCH_ACTIVITIES as readonly string[]).includes(activity)) {
    throw new BadRequestException('Pick an activity to continue');
  }

  const timePreference =
    typeof raw.timePreference === 'string' ? raw.timePreference.trim() : '';
  if (!(TIME_PREFERENCES as readonly string[]).includes(timePreference)) {
    throw new BadRequestException('Pick when you want to meet');
  }

  const rawCampus = typeof raw.campus === 'string' ? raw.campus.trim() : '';
  if (!rawCampus) {
    throw new BadRequestException('We could not determine your campus');
  }
  const campus = rawCampus.slice(0, CAMPUS_MAX);

  let optionalDetail: string | null = null;
  if (typeof raw.optionalDetail === 'string') {
    const trimmed = raw.optionalDetail.trim();
    optionalDetail = trimmed ? trimmed.slice(0, OPTIONAL_DETAIL_MAX) : null;
  }

  // `location` is optional; an absent or malformed block degrades to "no
  // location" rather than rejecting the whole join.
  const location =
    raw.location && typeof raw.location === 'object' ? raw.location : {};

  let area: string | null = null;
  if (typeof location.area === 'string' && location.area.trim()) {
    const candidate = location.area.trim();
    if (!(CAMPUS_AREAS as readonly string[]).includes(candidate)) {
      throw new BadRequestException('Unknown campus area');
    }
    area = candidate;
  }

  let gps: GpsPoint | null = null;
  const rawGps = location.gps;
  if (rawGps && typeof rawGps === 'object') {
    const { latitude, longitude } = rawGps;
    if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
      throw new BadRequestException('Invalid coordinates');
    }
    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestException('Invalid coordinates');
    }
    gps = { latitude, longitude };
  }

  return {
    userId,
    campus,
    activity,
    timePreference,
    optionalDetail,
    area,
    gps,
  };
}

export function parseMatchRespondPayload(raw: any): {
  matchId: string;
  action: 'accept' | 'decline';
} {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException('Malformed request');
  }
  const matchId = typeof raw.matchId === 'string' ? raw.matchId.trim() : '';
  if (!matchId) {
    throw new BadRequestException('Missing match id');
  }
  if (raw.action !== 'accept' && raw.action !== 'decline') {
    throw new BadRequestException('Invalid action');
  }
  return { matchId, action: raw.action };
}

export function toQueueSnapshot(dto: JoinQueueDto): QueueSnapshot {
  const { userId: _userId, ...rest } = dto;
  return rest;
}

/** Reads a snapshot back off a MatchSession's JSON column, tolerating
 *  rows written before the column existed. */
export function readQueueSnapshot(value: unknown): QueueSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.activity !== 'string' || typeof v.timePreference !== 'string')
    return null;
  if (typeof v.campus !== 'string') return null;
  return {
    campus: v.campus,
    activity: v.activity,
    timePreference: v.timePreference,
    optionalDetail:
      typeof v.optionalDetail === 'string' ? v.optionalDetail : null,
    area: typeof v.area === 'string' ? v.area : null,
    gps:
      v.gps &&
      typeof v.gps === 'object' &&
      isFiniteNumber((v.gps as any).latitude) &&
      isFiniteNumber((v.gps as any).longitude)
        ? {
            latitude: (v.gps as any).latitude,
            longitude: (v.gps as any).longitude,
          }
        : null,
  };
}
