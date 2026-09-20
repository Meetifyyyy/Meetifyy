/**
 * Intent contract tests.
 *
 * `parseIntent` is a trust boundary: its input arrives from a push payload and
 * from an OS deep link, both of which are attacker-influenceable. Most of what
 * is below is therefore about what it REFUSES, not what it accepts — an intent
 * that parses when it should not becomes a navigation somebody else chose.
 *
 * No DOM here on purpose; these run in the default `node` environment, which is
 * itself a check that the module under test stays portable.
 */
import { describe, it, expect } from 'vitest';
import {
  INTENT_VERSION,
  Intents,
  parseIntent,
  parseIntentFromPath,
  intentToPushData,
  intentFromNotificationEntity,
} from '../intents';

describe('parseIntent — accepts well-formed intents', () => {
  it('round-trips every constructor', () => {
    const all = [
      Intents.feed(),
      Intents.notifications(),
      Intents.saved(),
      Intents.profile('alice'),
      Intents.post('p1'),
      Intents.chat('c1'),
      Intents.community('g1'),
      Intents.activity('a1'),
      Intents.event('e1'),
      Intents.settings(),
      Intents.settings('verification'),
    ];
    for (const intent of all) {
      expect(parseIntent(intent)).toEqual(intent);
    }
  });

  it('ignores unknown extra keys rather than carrying them through', () => {
    const parsed = parseIntent({ t: 'post', id: 'p1', evil: 'payload' });
    expect(parsed).toEqual({ t: 'post', id: 'p1' });
    expect(parsed).not.toHaveProperty('evil');
  });
});

describe('parseIntent — refuses malformed input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'post'],
    ['a number', 7],
    ['an array', ['post']],
    ['no type', { id: 'p1' }],
    ['unknown type', { t: 'admin', id: 'p1' }],
    ['missing id', { t: 'post' }],
    ['empty id', { t: 'post', id: '' }],
    ['non-string id', { t: 'post', id: 123 }],
    ['missing username', { t: 'profile' }],
    ['missing conversationId', { t: 'chat' }],
  ])('returns null for %s', (_label, input) => {
    expect(parseIntent(input)).toBeNull();
  });

  it('caps identifier length', () => {
    expect(parseIntent({ t: 'post', id: 'x'.repeat(200) })).not.toBeNull();
    expect(parseIntent({ t: 'post', id: 'x'.repeat(201) })).toBeNull();
  });

  it('treats an unknown type as null rather than throwing', () => {
    // A newer server's intent reaching an older installed app is expected, not
    // exceptional: a native client cannot be force-updated. The client falls
    // back to simply opening the app.
    expect(() => parseIntent({ t: 'somethingNew', id: 'x' })).not.toThrow();
    expect(parseIntent({ t: 'somethingNew', id: 'x' })).toBeNull();
  });

  it('settings tolerates a missing panel but refuses a non-string one', () => {
    expect(parseIntent({ t: 'settings' })).toEqual({ t: 'settings' });
    expect(parseIntent({ t: 'settings', panel: 42 })).toEqual({ t: 'settings' });
    expect(parseIntent({ t: 'settings', panel: 'devices' })).toEqual({
      t: 'settings',
      panel: 'devices',
    });
  });
});

describe('parseIntentFromPath', () => {
  it.each([
    ['/home', { t: 'feed' }],
    ['/notifications', { t: 'notifications' }],
    ['/saved', { t: 'saved' }],
    ['/post/abc', { t: 'post', id: 'abc' }],
    ['/profile/alice', { t: 'profile', username: 'alice' }],
    ['/communities/g1', { t: 'community', id: 'g1' }],
    ['/crew/a1', { t: 'activity', id: 'a1' }],
    ['/campus/events/e1', { t: 'event', id: 'e1' }],
    ['/messages/c1', { t: 'chat', conversationId: 'c1' }],
    ['/settings', { t: 'settings' }],
    ['/settings/devices', { t: 'settings', panel: 'devices' }],
  ])('%s', (path, expected) => {
    expect(parseIntentFromPath(path)).toEqual(expected);
  });

  it('strips query and fragment', () => {
    expect(parseIntentFromPath('/post/abc?ref=push#top')).toEqual({
      t: 'post',
      id: 'abc',
    });
  });

  it('refuses paths that are not link destinations', () => {
    // `/crew/create` is an action, and a bare `/communities` or `/profile` has
    // no target — routing either somewhere generic would be a worse answer than
    // "just open the app".
    expect(parseIntentFromPath('/crew/create')).toBeNull();
    expect(parseIntentFromPath('/communities')).toBeNull();
    expect(parseIntentFromPath('/profile')).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['root', '/'],
    ['relative', 'post/abc'],
    ['protocol-ish', 'https://evil.example.com/post/abc'],
    ['unknown route', '/admin/users'],
    ['non-string', null],
  ])('returns null for %s', (_label, path) => {
    expect(parseIntentFromPath(path)).toBeNull();
  });
});

describe('intentFromNotificationEntity', () => {
  it('maps the backend NotificationEntityType values', () => {
    expect(intentFromNotificationEntity('POST', 'p1')).toEqual({ t: 'post', id: 'p1' });
    expect(intentFromNotificationEntity('COMMUNITY', 'g1')).toEqual({
      t: 'community',
      id: 'g1',
    });
    expect(intentFromNotificationEntity('ACTIVITY', 'a1')).toEqual({
      t: 'activity',
      id: 'a1',
    });
    expect(intentFromNotificationEntity('MESSAGE', 'c1')).toEqual({
      t: 'chat',
      conversationId: 'c1',
    });
  });

  it('resolves COMMENT to its post, and refuses when the post is unknown', () => {
    // There is no comment screen — a comment is read inside its post. Without a
    // post id there is no correct destination, and a wrong one is worse than
    // none.
    expect(intentFromNotificationEntity('COMMENT', 'c9', { postId: 'p1' })).toEqual({
      t: 'post',
      id: 'p1',
    });
    expect(intentFromNotificationEntity('COMMENT', 'c9')).toBeNull();
    expect(intentFromNotificationEntity('COMMENT', 'c9', { postId: null })).toBeNull();
  });

  it('returns null for unknown or missing entities', () => {
    expect(intentFromNotificationEntity('FOLLOW', 'u1')).toBeNull();
    expect(intentFromNotificationEntity('POST', null)).toBeNull();
    expect(intentFromNotificationEntity(null, null)).toBeNull();
  });
});

describe('intentToPushData', () => {
  it('is flat, all-string, and version-stamped', () => {
    const data = intentToPushData(Intents.chat('c1'));
    expect(data).toEqual({ v: INTENT_VERSION, t: 'chat', conversationId: 'c1' });
    for (const value of Object.values(data)) {
      // FCM and APNs carry string values only.
      expect(typeof value).toBe('string');
    }
  });

  it('omits an absent settings panel rather than sending undefined', () => {
    expect(intentToPushData(Intents.settings())).toEqual({
      v: INTENT_VERSION,
      t: 'settings',
    });
  });

  it('survives a round trip through the wire shape', () => {
    for (const intent of [
      Intents.post('p1'),
      Intents.profile('alice'),
      Intents.chat('c1'),
      Intents.event('e1'),
      Intents.settings('devices'),
      Intents.feed(),
    ]) {
      expect(parseIntent(intentToPushData(intent))).toEqual(intent);
    }
  });

  it('carries no field that is not routing data', () => {
    // A push payload transits Google and Apple infrastructure and lands in OS
    // logs. Nothing from the notification's content belongs in it.
    const data = intentToPushData(Intents.chat('c1'));
    expect(Object.keys(data).sort()).toEqual(['conversationId', 't', 'v']);
  });
});
