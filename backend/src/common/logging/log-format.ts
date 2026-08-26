/**
 * One line format for every backend log, so the terminal can be scanned
 * vertically instead of read.
 *
 * Every line is `LABEL  subject  …  facts`, with the columns in fixed
 * positions: what kind of event it was, what it acted on, how long it took,
 * and who it was for. Before this each source invented its own shape — the
 * HTTP logger carried a request id but no user, the exception filter carried a
 * user but formatted the route differently, and Prisma printed raw SQL with
 * neither — so nothing lined up and correlating a slow request with the
 * queries it ran meant reading every line in full.
 */

/**
 * Where HttpExceptionFilter parks the reason a request was refused, for the
 * pino-http response line to pick up. A well-known key on the raw request is
 * the only channel between the two: the filter runs while handling the
 * exception, the response line is written after the response finishes, and
 * nothing is shared between them but the request object.
 */
export const LOG_CAUSE = '__logCause';

/**
 * Read a property off a request without caring which shape it arrived in.
 *
 * pino hands two different objects to two different hooks: serializers get
 * pino-http's wrapper (the Express request is under `.raw`), while
 * `customSuccessMessage` gets the raw request directly. Reaching for `.raw` in
 * the latter silently yielded `undefined` — which is why the user id was
 * missing from every success line even after it was "added".
 */
export function fromRequest<T = any>(
  req: any,
  path: (r: any) => T,
): T | undefined {
  if (!req) return undefined;
  return path(req) ?? path(req.raw) ?? undefined;
}

/**
 * Column widths, tuned so the common cases align without wrapping at 120 cols.
 *
 * There is deliberately no label column here: the subsystem is already carried
 * by the padded `[context]` prefix that `contextPrefix` renders, and printing
 * `[HTTP] HTTP GET …` said it twice.
 */
const W = { context: 8, method: 6, path: 44, status: 4, ms: 7 };

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width
    ? value
    : ' '.repeat(width - value.length) + value;
}

/**
 * Ids are logged as an 8-character prefix. A full UUID is 36 characters and
 * two of them per line pushed the useful facts off the right edge; 8 is still
 * unique enough to correlate a request across lines by eye, and the full value
 * remains in the structured record for machine search.
 */
export function shortId(id?: string | null): string {
  if (!id) return '';
  const s = String(id);
  return s.length > 8 ? s.slice(0, 8) : s;
}

/** Trim a path from the left, keeping the distinctive tail. */
export function shortPath(url: string, width = W.path): string {
  const u = url || '';
  return u.length <= width ? u : '…' + u.slice(u.length - (width - 1));
}

export function formatMs(ms?: number): string {
  if (ms == null || Number.isNaN(ms)) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** Trailing `key=value` facts, blanks omitted. */
export function facts(
  pairs: Record<string, string | number | undefined | null>,
): string {
  return Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

export interface HttpLine {
  method?: string;
  url?: string;
  status?: number;
  ms?: number;
  userId?: string;
  reqId?: string;
  /** Appended after a `✗` marker — the root cause on a failure. */
  cause?: string;
  /** Extra trailing facts, e.g. a redacted request body. */
  extra?: string;
}

export function httpLine(l: HttpLine): string {
  const cols = [
    pad((l.method || '').toUpperCase(), W.method),
    pad(shortPath(l.url || ''), W.path),
    padStart(l.status != null ? String(l.status) : '', W.status),
    padStart(formatMs(l.ms), W.ms),
    facts({ user: shortId(l.userId), req: shortId(l.reqId) }),
  ];
  let line = cols.join(' ').trimEnd();
  if (l.extra) line += ` ${l.extra}`;
  if (l.cause) line += `  ✗ ${l.cause}`;
  return line;
}

/** Database activity: `DB    SELECT ConversationParticipant      83ms`. */
export function dbLine(summary: string, ms?: number, extra?: string): string {
  // Spans the method + path + status columns so the latency lands in the same
  // place it does on an HTTP line — that column is the anchor when correlating
  // a request with the queries it fired.
  const line = [
    pad(summary, W.method + 1 + W.path + 1 + W.status),
    padStart(formatMs(ms), W.ms),
  ]
    .join(' ')
    .trimEnd();
  return extra ? `${line} ${extra}` : line;
}

/**
 * Fixed-width `[context]` prefix.
 *
 * pino-pretty's `{context}` template interpolates the raw value, so a line
 * from `PrismaService` and one from `HTTP` started at different columns and
 * nothing below the prefix lined up — which defeats the format. Padding it
 * keeps every subsequent column at a fixed offset regardless of which
 * subsystem spoke. Long context names are truncated rather than allowed to
 * push the line right.
 *
 * This must be applied through pino's `formatters.log`, NOT through a
 * `messageFormat` function: pino-pretty runs in a worker thread, so everything
 * inside `transport.options` is structured-cloned and a function there throws
 * `DataCloneError` at boot. `formatters.log` runs in the main thread before the
 * record is handed over, so a function is legal.
 */
export function contextPrefix(context?: string, width = W.context): string {
  const name = (context || 'app').slice(0, width);
  // width + 2 brackets + 1 separating space, so the message never abuts a
  // context that happened to fill the full width.
  return pad(`[${name}]`, width + 3);
}

/* ── Pretty-print prefix ──────────────────────────────────────────────────
 *
 * Everything below builds the `time level [context]` prefix by hand, because
 * pino-pretty cannot be made to align it:
 *
 *  - `messageFormat` must be a plain string. pino-pretty runs in a worker
 *    thread, so anything inside `transport.options` is structured-cloned and a
 *    function there throws `DataCloneError` before the app can boot.
 *  - Its own level rendering is variable width (`INFO:` vs `ERROR:`), which
 *    shifted every following column by a character depending on severity.
 *
 * So the prefix is assembled in `formatters`, which run in the main thread,
 * and pino-pretty is told to ignore the raw `time`, `level` and `context` keys
 * and just interpolate the pre-built ones. Colour is applied here for the same
 * reason — hiding pino-pretty's level also hid its colouring, and colour is
 * what makes an ERROR findable in a scrolling terminal.
 *
 * All of this is for human output only. It is wired up solely when
 * `config.logging.pretty` is on; structured JSON logs never see these fields
 * or the escape codes in them.
 */

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
} as const;

const LEVEL_COLOR: Record<string, string> = {
  TRACE: ANSI.dim,
  DEBUG: ANSI.dim,
  INFO: ANSI.green,
  WARN: ANSI.yellow,
  ERROR: ANSI.red,
  FATAL: ANSI.magenta,
};

/** Fixed-width, coloured level label. */
export function paintLevel(label: string): string {
  const upper = String(label || '').toUpperCase();
  return `${LEVEL_COLOR[upper] || ''}${pad(upper, 5)}${ANSI.reset}`;
}

/** `HH:MM:ss`, dimmed — the date is the same all session and only costs room. */
export function clockStamp(now = new Date()): string {
  const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return `${ANSI.dim}${hhmmss}${ANSI.reset}`;
}

/** The keys pino-pretty must not print itself — they are rebuilt into the message. */
export const PRETTY_IGNORE =
  'pid,hostname,req,res,responseTime,context,level,lvl,time,ts';

/** `{ts} {lvl} {context}{msg}` — the assembled prefix, then the line. */
export const PRETTY_MESSAGE_FORMAT = '{ts} {lvl} {context}{msg}';

/** pino `formatters` that build the aligned prefix. Pretty output only. */
export const prettyFormatters = {
  level: (label: string, number: number) => ({
    level: number,
    lvl: paintLevel(label),
  }),
  log: (obj: any) => ({
    ...obj,
    ts: clockStamp(),
    // nestjs-pino stamps `context` on every log a Nest service makes, so a
    // record without one came from pino-http's own request/response logging —
    // hence HTTP as the default rather than a generic "app".
    //
    // pino-http's `customProps` cannot supply it: that creates a child-logger
    // *binding*, which is serialized straight into the output and never
    // reaches this formatter, so the value here would overwrite it with the
    // default anyway.
    context: contextPrefix(obj?.context || 'HTTP'),
  }),
};
