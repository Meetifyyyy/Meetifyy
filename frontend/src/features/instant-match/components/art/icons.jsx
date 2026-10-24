/**
 * The Instant Match icon set.
 *
 * Drawn for this feature, on one 24px grid with one stroke weight, so an
 * activity, a time and a campus area read as a family wherever they appear —
 * the picker, the roster, the match card, the chat strip. They replace the
 * emoji the flow used to lean on, which rendered differently on every
 * platform and could not take the app's colours.
 *
 * Every icon inherits `currentColor` and is decorative: the label beside it
 * is what assistive technology reads.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
};

function Svg({ className = '', children }) {
  return <svg className={`im-icon ${className}`} {...base}>{children}</svg>;
}

/* ── Activities ─────────────────────────────────────────────────────────── */

const ACTIVITY_PATHS = {
  study: (
    <>
      <path d="M12 6.5C10.6 5.2 8.4 4.5 4.5 4.5v13c3.9 0 6.1.7 7.5 2 1.4-1.3 3.6-2 7.5-2v-13c-3.9 0-6.1.7-7.5 2Z" />
      <path d="M12 6.5v13" />
      <path d="M15.5 4.8v4.4l1.3-1 1.2 1V4.6" />
    </>
  ),
  coding: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 8.5h18" />
      <path d="m9 12-2 2 2 2" />
      <path d="m15 12 2 2-2 2" />
      <path d="m12.8 11.5-1.6 5" />
    </>
  ),
  sports: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6c2.6 3.3 2.6 8.7 0 12" />
      <path d="M18 6c-2.6 3.3-2.6 8.7 0 12" />
    </>
  ),
  coffee: (
    <>
      <path d="M4.5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9.5Z" />
      <path d="M15.5 11h1.25a2.25 2.25 0 0 1 0 4.5H15.2" />
      <path d="M8.5 3.8c-.7.9.7 1.7 0 2.7" />
      <path d="M11.5 3.8c-.7.9.7 1.7 0 2.7" />
      <path d="M3.5 21h13" />
    </>
  ),
  food: (
    <>
      <path d="M3.5 12.5h17c0 4.2-3.8 7-8.5 7s-8.5-2.8-8.5-7Z" />
      <path d="m13.5 3.5-3 6.5" />
      <path d="m18.5 4.5-4.6 5.5" />
      <path d="M9 19.5v1h6v-1" />
    </>
  ),
  gaming: (
    <>
      <path d="M7.2 7.5h9.6a4 4 0 0 1 3.97 4.5l-.42 3.4a2.6 2.6 0 0 1-4.53 1.38L14.4 15h-4.8l-1.42 1.78a2.6 2.6 0 0 1-4.53-1.38L3.23 12A4 4 0 0 1 7.2 7.5Z" />
      <path d="M8 10.5v3" />
      <path d="M6.5 12h3" />
      <circle cx="15.5" cy="11" r="0.4" fill="currentColor" />
      <circle cx="17" cy="13" r="0.4" fill="currentColor" />
    </>
  ),
  walk: (
    <>
      <path d="M8.2 3.5c1.6 0 2.6 1.8 2.6 4s-1 3.6-2.6 3.6S5.6 9.7 5.6 7.5s1-4 2.6-4Z" />
      <path d="M6.6 14h3.3c0 1.6-.6 2.6-1.65 2.6S6.6 15.6 6.6 14Z" />
      <path d="M15.8 7.5c1.6 0 2.6 1.8 2.6 4s-1 3.6-2.6 3.6-2.6-1.4-2.6-3.6 1-4 2.6-4Z" />
      <path d="M14.2 18h3.3c0 1.6-.6 2.6-1.65 2.6s-1.65-1-1.65-2.6Z" />
    </>
  ),
  movie: (
    <>
      <rect x="3.5" y="9" width="17" height="11" rx="2" />
      <path d="m3.4 9-.5-3a1.5 1.5 0 0 1 1.2-1.7l13.5-2.2a1.5 1.5 0 0 1 1.7 1.2l.4 2.4L3.4 9Z" />
      <path d="m8 4.2 1.8 3" />
      <path d="m13 3.4 1.8 3" />
      <path d="m10.5 12.5 3.5 2-3.5 2v-4Z" />
    </>
  ),
  event: (
    <>
      <path d="M4 9.2V7a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7v2.2a2.8 2.8 0 0 0 0 5.6V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17v-2.2a2.8 2.8 0 0 0 0-5.6Z" />
      <path d="M14.5 5.5v13" strokeDasharray="1.6 2.4" />
      <path d="m9.25 9.6.75 1.5 1.65.25-1.2 1.15.3 1.65-1.5-.8-1.5.8.3-1.65-1.2-1.15 1.65-.25.75-1.5Z" />
    </>
  ),
  chat: (
    <>
      <path d="M14.5 8.5V7A2.5 2.5 0 0 0 12 4.5H6A2.5 2.5 0 0 0 3.5 7v4A2.5 2.5 0 0 0 6 13.5h.5V16l2.7-2.5" />
      <path d="M12 8.5h6a2.5 2.5 0 0 1 2.5 2.5v3.5A2.5 2.5 0 0 1 18 17h-.5v2.5L14.8 17H12a2.5 2.5 0 0 1-2.5-2.5V11A2.5 2.5 0 0 1 12 8.5Z" />
    </>
  ),
  library: (
    <>
      <path d="M5 4.5h3.2v15H5z" />
      <path d="M8.2 7h3.2v12.5H8.2z" />
      <path d="m13.4 7.6 3-.8 3.3 12.3-3 .8z" />
      <path d="M3.5 19.5h17" />
      <path d="M5 8h3.2" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.4 8.6-2 4.8-4.8 2 2-4.8 4.8-2Z" />
    </>
  ),
};

/** The raw strokes of an activity icon, for drawing it inside another SVG. */
export function activityGlyph(id) {
  return ACTIVITY_PATHS[id] || ACTIVITY_PATHS.other;
}

export function ActivityIcon({ id, className = '' }) {
  return <Svg className={className}>{ACTIVITY_PATHS[id] || ACTIVITY_PATHS.other}</Svg>;
}

/* ── When ───────────────────────────────────────────────────────────────── */

const TIME_PATHS = {
  now: (
    <>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8" />
      <path d="M15.9 8.1a5.5 5.5 0 0 1 0 7.8" />
      <path d="M5.3 5.3a9.5 9.5 0 0 0 0 13.4" />
      <path d="M18.7 5.3a9.5 9.5 0 0 1 0 13.4" />
    </>
  ),
  '30min': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" fillOpacity="0.16" stroke="none" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  today: (
    <>
      <path d="M6.5 16.5a5.5 5.5 0 0 1 11 0" />
      <path d="M3 16.5h18" />
      <path d="M7 20h10" />
      <path d="M12 5v2.5" />
      <path d="m5.6 8.6 1.6 1.6" />
      <path d="m18.4 8.6-1.6 1.6" />
    </>
  ),
};

export function TimeIcon({ id, className = '' }) {
  return <Svg className={className}>{TIME_PATHS[id] || TIME_PATHS.now}</Svg>;
}

/* ── Campus areas ───────────────────────────────────────────────────────── */

const AREA_PATHS = {
  '': (
    <>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="2.2 2.6" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  library: ACTIVITY_PATHS.library,
  cafeteria: (
    <>
      <path d="M6 3.5v5a2 2 0 0 0 4 0v-5" />
      <path d="M8 10.5v10" />
      <path d="M16.5 20.5v-17c2 1.4 3 4 3 7.5h-3" />
    </>
  ),
  hostel: (
    <>
      <path d="m3.5 11 8.5-6.5 8.5 6.5" />
      <path d="M5.5 9.5v10h13v-10" />
      <path d="M8.5 15.5h7" />
      <path d="M8.5 13v6.5" />
      <path d="M15.5 15.5v4" />
    </>
  ),
  academic_block: (
    <>
      <path d="M3.5 9 12 4.5 20.5 9" />
      <path d="M5.5 10v7" />
      <path d="M10 10v7" />
      <path d="M14 10v7" />
      <path d="M18.5 10v7" />
      <path d="M3.5 20h17" />
      <path d="M4.5 17h15" />
    </>
  ),
  sports_complex: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="6" />
      <rect x="7" y="9.5" width="10" height="5" rx="2.5" />
      <path d="M12 6v3.5" />
      <path d="M12 14.5V18" />
    </>
  ),
  main_gate: (
    <>
      <path d="M4.5 20V10.5a7.5 7.5 0 0 1 15 0V20" />
      <path d="M12 3v17" />
      <path d="M8 20v-8" />
      <path d="M16 20v-8" />
      <path d="M3 20h18" />
    </>
  ),
  other: (
    <>
      <path d="M12 20.5s-6.5-5.4-6.5-10.5a6.5 6.5 0 0 1 13 0c0 5.1-6.5 10.5-6.5 10.5Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
};

/** The raw strokes of an area icon, for drawing it inside another SVG. */
export function areaGlyph(id) {
  return AREA_PATHS[id ?? ''] || AREA_PATHS.other;
}

export function AreaIcon({ id, className = '' }) {
  return <Svg className={className}>{AREA_PATHS[id ?? ''] || AREA_PATHS.other}</Svg>;
}

/* ── Interface ──────────────────────────────────────────────────────────── */

export function CloseIcon({ className = '' }) {
  return <Svg className={className}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
}

export function ChevronDownIcon({ className = '' }) {
  return <Svg className={className}><path d="m6 9 6 6 6-6" /></Svg>;
}

export function ChevronRightIcon({ className = '' }) {
  return <Svg className={className}><path d="m9 6 6 6-6 6" /></Svg>;
}

export function BackIcon({ className = '' }) {
  return <Svg className={className}><path d="M15 18 9 12l6-6" /></Svg>;
}

export function ArrowRightIcon({ className = '' }) {
  return <Svg className={className}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
}

export function CheckIcon({ className = '' }) {
  return <Svg className={className}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
}

export function PinIcon({ className = '' }) {
  return <Svg className={className}>{AREA_PATHS.other}</Svg>;
}

export function ClockIcon({ className = '' }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function LocateIcon({ className = '' }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </Svg>
  );
}

export function PeopleIcon({ className = '' }) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18 14a6.5 6.5 0 0 1 3.5 5.5" />
    </Svg>
  );
}

export function RefreshIcon({ className = '' }) {
  return (
    <Svg className={className}>
      <path d="M20 11.5A8 8 0 0 0 5.6 7" />
      <path d="M4 12.5A8 8 0 0 0 18.4 17" />
      <path d="M5 3.5V7h3.5" />
      <path d="M19 20.5V17h-3.5" />
    </Svg>
  );
}

export function OfflineIcon({ className = '' }) {
  return (
    <Svg className={className}>
      <path d="M3 3l18 18" />
      <path d="M8.5 16.2a5 5 0 0 1 6.2-.6" />
      <path d="M5.2 12.8a9.5 9.5 0 0 1 4.3-2.3" />
      <path d="M14.3 10.4a9.5 9.5 0 0 1 4.5 2.4" />
      <path d="M2 9.3a14 14 0 0 1 4-2.6" />
      <path d="M10.6 5.6A14 14 0 0 1 22 9.3" />
      <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
    </Svg>
  );
}

export function AlertIcon({ className = '' }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </Svg>
  );
}

export function ChatIcon({ className = '' }) {
  return (
    <Svg className={className}>
      <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-4.6A7.5 7.5 0 1 1 20 11.5Z" />
    </Svg>
  );
}

export function SpinnerIcon({ className = '' }) {
  return (
    <svg className={`im-spinner ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" strokeOpacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}
