import { httpLine, dbLine, shortId, shortPath, formatMs, contextPrefix } from './log-format';

/**
 * The log line is a UI. These assert the columns stay where they are, because
 * the whole value of the format is that it can be scanned vertically.
 */
describe('log-format', () => {
  it('puts every fact on one HTTP line', () => {
    expect(httpLine({
      method: 'GET', url: '/api/messages?limit=50', status: 200, ms: 83,
      userId: '189d7031-81c2-46c0-9d63-671c770d9973', reqId: '106eb8f0-2b1d-4caa-8ca4-f8f37afa551f',
    })).toBe('GET    /api/messages?limit=50                        200    83ms user=189d7031 req=106eb8f0');
  
});

  it('marks the cause of a failure after the facts', () => {
    const line = httpLine({
      method: 'GET', url: '/api/messages', status: 500, ms: 91,
      userId: '189d7031-aaaa', reqId: 'req12345-bbbb',
      cause: 'The column `t0.pinnedAt` does not exist in the current database.',
    });
    expect(line).toContain('500');
    expect(line).toContain('✗ The column `t0.pinnedAt` does not exist');
    expect(line.indexOf('user=')).toBeLessThan(line.indexOf('✗'));
  });

  it('keeps the distinctive tail of a long path', () => {
    const trimmed = shortPath('/api/messages/c_0123456789abcdef0123456789abcdef/messages', 20);
    expect(trimmed).toHaveLength(20);
    expect(trimmed.startsWith('…')).toBe(true);
    // The tail is what distinguishes one route from another; the shared
    // `/api/messages/` prefix is the part safe to drop.
    expect(trimmed.endsWith('/messages')).toBe(true);
    expect(shortPath('/api/short', 20)).toBe('/api/short');
  });

  it('shortens ids to a correlatable prefix', () => {
    expect(shortId('189d7031-81c2-46c0-9d63-671c770d9973')).toBe('189d7031');
    expect(shortId(null)).toBe('');
  });

  it('switches to seconds once a request is slow enough to care', () => {
    expect(formatMs(83)).toBe('83ms');
    expect(formatMs(1450)).toBe('1.45s');
    expect(formatMs(undefined)).toBe('');
  });

  it('omits blank facts rather than printing empty keys', () => {
    expect(httpLine({ method: 'GET', url: '/health', status: 200, ms: 2 }))
      .not.toContain('user=');
  });

  it('aligns DB lines to the same columns as HTTP lines', () => {
    const db = dbLine('SELECT ConversationParticipant', 83);
    const http = httpLine({ method: 'GET', url: '/api/messages', status: 200, ms: 83 });
    // The latency column is the anchor when correlating a request with the
    // queries it fired, so it must land in the same place in both.
    expect(db.indexOf('83ms')).toBe(http.indexOf('83ms'));
  });

  it('pads every context to the same width so columns survive the prefix', () => {
    const short = contextPrefix('DB');
    const long = contextPrefix('InstantMatchService');
    expect(short).toHaveLength(long.length);
    // Truncated rather than allowed to push the rest of the line right.
    expect(long.trim()).toBe('[InstantM]');
  });

  it('lines up two different subsystems at the same column', () => {
    const a = contextPrefix('DB') + dbLine('SELECT User', 83);
    const b = contextPrefix('HTTP') + httpLine({ method: 'GET', url: '/api/x', status: 200, ms: 83 });
    expect(a.indexOf('83ms')).toBe(b.indexOf('83ms'));
  });
});
