/**
 * Group invite links and the admins' "open Join requests" push, through the
 * intent layer: parsed from a link or a push, and resolved to a route by the
 * app, the website and the service worker alike. Both arrive from outside
 * (an OS deep link, a push payload), so most of this is what they refuse.
 */
import { describe, it, expect } from 'vitest';
import { Intents, parseIntent, parseIntentFromPath, intentToPushData } from '../../../core/navigation/intents';
import { intentToRoute } from '../intentToRoute';
import { intentPath } from '../../../shared/push/intentPath';
import { pushPath } from '../../../shared/push/serviceWorkerPush';

describe('invite links: /g/<code>', () => {
  it('parses a link and resolves it to the same path in the app and on the website', () => {
    const intent = parseIntentFromPath('/g/Abc123Def456');
    expect(intent).toEqual({ t: 'groupInvite', code: 'Abc123Def456' });
    expect(intentToRoute(intent)).toBe('/g/Abc123Def456');
    expect(intentPath(intent)).toBe('/g/Abc123Def456');
  });

  it('refuses a code that is anything but letters and digits', () => {
    expect(parseIntentFromPath('/g/')).toBeNull();
    expect(parseIntentFromPath('/g/..%2Fsettings')).toBeNull();
    expect(parseIntentFromPath('/g/abc-def')).toBeNull();
    expect(parseIntentFromPath(`/g/${'a'.repeat(17)}`)).toBeNull();
    expect(parseIntent({ t: 'groupInvite', code: '../x' })).toBeNull();
    expect(parseIntent({ t: 'groupInvite' })).toBeNull();
  });

  it('survives a push payload', () => {
    const data = intentToPushData(Intents.groupInvite('Abc123Def456'));
    expect(data).toMatchObject({ t: 'groupInvite', code: 'Abc123Def456' });
    expect(parseIntent(data)).toEqual({ t: 'groupInvite', code: 'Abc123Def456' });
  });
});

describe("an admin's push for a request: the group's Join requests page", () => {
  const push = { v: '1', t: 'chat', conversationId: 'pub-1', panel: 'requests' };

  it('opens the requests page in the app, on the website and from the service worker', () => {
    const intent = parseIntent(push);
    expect(intent).toEqual({ t: 'chat', conversationId: 'pub-1', panel: 'requests' });
    expect(intentToRoute(intent)).toBe('/messages/pub-1?panel=requests');
    expect(intentPath(intent)).toBe('/messages/pub-1?panel=requests');
    expect(pushPath(intent)).toBe('/messages/pub-1?panel=requests');
  });

  it("keeps the page through the worker's path, which the page parses again", () => {
    expect(parseIntentFromPath('/messages/pub-1?panel=requests')).toEqual(intent('pub-1', 'requests'));
    expect(parseIntentFromPath('/messages/pub-1')).toEqual(intent('pub-1'));
  });

  it('ignores any other panel value, and a chat without one opens the chat', () => {
    expect(parseIntent({ ...push, panel: '../../settings' })).toEqual(intent('pub-1'));
    expect(parseIntentFromPath('/messages/pub-1?panel=settings')).toEqual(intent('pub-1'));
    expect(intentToRoute(intent('pub-1'))).toBe('/messages/pub-1');
  });

  it('round-trips through push data', () => {
    expect(parseIntent(intentToPushData(Intents.chat('pub-1', 'requests')))).toEqual(intent('pub-1', 'requests'));
  });
});

function intent(conversationId, panel) {
  return panel ? { t: 'chat', conversationId, panel } : { t: 'chat', conversationId };
}
