/**
 * A graduation cap in the same 3D-style vector language as the event icons
 * (campus-events/components/Event3DIcons.jsx): gradient faces, a thin lit edge, a small specular highlight. Used for "Campus" where a
 * flat line icon would look out of place beside the app's other 3D marks.
 *
 * No drop shadow: it sits flat on its sheet. Gradient ids are prefixed so several icons can share a page.
 */
export default function Campus3DIcon({ size = 48, className = '', style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <defs>
        {/* The cap's crown, under the board */}
        <linearGradient id="cap3d_crown" x1="9" y1="15" x2="23" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2F4FA8" />
          <stop offset="100%" stopColor="#14275F" />
        </linearGradient>

        {/* The board's top face */}
        <linearGradient id="cap3d_top" x1="5" y1="7" x2="27" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6EA3FF" />
          <stop offset="55%" stopColor="#3B6FE0" />
          <stop offset="100%" stopColor="#2349B5" />
        </linearGradient>

        {/* The board's thickness, the side facing the viewer */}
        <linearGradient id="cap3d_edge" x1="3" y1="13" x2="29" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1B3A8C" />
          <stop offset="100%" stopColor="#0F2260" />
        </linearGradient>

        <linearGradient id="cap3d_gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE08A" />
          <stop offset="100%" stopColor="#E9A526" />
        </linearGradient>

        <linearGradient id="cap3d_shine" x1="6" y1="8" x2="20" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g>
        {/* Crown */}
        <path
          d="M9 15.2V21.4C9 23.6 12.1 25.4 16 25.4C19.9 25.4 23 23.6 23 21.4V15.2L16 18.4L9 15.2Z"
          fill="url(#cap3d_crown)"
        />
        {/* Board thickness */}
        <path d="M3 12.2L16 18.2L29 12.2V13.9L16 19.9L3 13.9V12.2Z" fill="url(#cap3d_edge)" />
        {/* Board top */}
        <path d="M16 6.2L29 12.2L16 18.2L3 12.2L16 6.2Z" fill="url(#cap3d_top)" />
        {/* Lit edge along the back-left side */}
        <path d="M3.4 11.9L16 6.3" stroke="url(#cap3d_shine)" strokeWidth="1" strokeLinecap="round" />
        {/* Soft highlight on the top face */}
        <path d="M9.5 10.6L16 7.6L19.4 9.2L13 12.2L9.5 10.6Z" fill="#FFFFFF" fillOpacity="0.16" />
      </g>

      {/* Tassel */}
      <path d="M16 12.2L25.4 14.6V20" stroke="#E9A526" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="24.2" y="19.4" width="2.4" height="4.2" rx="1.1" fill="url(#cap3d_gold)" />
      <circle cx="16" cy="12.2" r="1.35" fill="url(#cap3d_gold)" />
    </svg>
  );
}
