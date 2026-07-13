const coverThemes = {
  design: {
    gradient: 'linear-gradient(135deg, #EC4899 0%, #F97316 100%)',
    bgCircles: [
      { cx: '85%', cy: '15%', r: '80', fill: 'rgba(255,255,255,0.08)' },
      { cx: '20%', cy: '80%', r: '60', fill: 'rgba(255,255,255,0.06)' },
      { cx: '60%', cy: '50%', r: '100', fill: 'rgba(255,255,255,0.04)' },
    ],
    icon: (
      <g transform="translate(12, 12)">
        <rect x="4" y="4" width="56" height="56" rx="8" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
        <circle cx="18" cy="18" r="6" fill="rgba(255,255,255,0.6)" />
        <circle cx="46" cy="18" r="6" fill="rgba(255,255,255,0.6)" />
        <circle cx="32" cy="40" r="6" fill="rgba(255,255,255,0.6)" />
        <line x1="18" y1="24" x2="32" y2="34" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
        <line x1="46" y1="24" x2="32" y2="34" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      </g>
    ),
  },
  ai: {
    gradient: 'linear-gradient(135deg, #1E40AF 0%, #06B6D4 100%)',
    bgCircles: [
      { cx: '80%', cy: '10%', r: '90', fill: 'rgba(255,255,255,0.07)' },
      { cx: '15%', cy: '75%', r: '70', fill: 'rgba(255,255,255,0.05)' },
      { cx: '50%', cy: '30%', r: '50', fill: 'rgba(255,255,255,0.06)' },
    ],
    icon: (
      <g transform="translate(12, 12)">
        <circle cx="32" cy="18" r="6" fill="rgba(255,255,255,0.7)" />
        <circle cx="14" cy="40" r="6" fill="rgba(255,255,255,0.7)" />
        <circle cx="50" cy="40" r="6" fill="rgba(255,255,255,0.7)" />
        <line x1="28" y1="23" x2="18" y2="36" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <line x1="36" y1="23" x2="46" y2="36" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <line x1="20" y1="40" x2="44" y2="40" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <circle cx="32" cy="18" r="2" fill="rgba(255,255,255,0.9)" />
        <circle cx="14" cy="40" r="2" fill="rgba(255,255,255,0.9)" />
        <circle cx="50" cy="40" r="2" fill="rgba(255,255,255,0.9)" />
      </g>
    ),
  },
  startup: {
    gradient: 'linear-gradient(135deg, #059669 0%, #10B981 50%, #34D399 100%)',
    bgCircles: [
      { cx: '75%', cy: '20%', r: '100', fill: 'rgba(255,255,255,0.06)' },
      { cx: '25%', cy: '70%', r: '70', fill: 'rgba(255,255,255,0.05)' },
      { cx: '50%', cy: '0%', r: '60', fill: 'rgba(255,255,255,0.04)' },
    ],
    icon: (
      <g transform="translate(12, 12)">
        <path d="M32 8 L42 28 L22 28 Z" fill="rgba(255,255,255,0.6)" />
        <rect x="18" y="28" width="28" height="4" rx="2" fill="rgba(255,255,255,0.3)" />
        <rect x="22" y="32" width="20" height="3" rx="1.5" fill="rgba(255,255,255,0.2)" />
        <line x1="32" y1="12" x2="32" y2="24" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      </g>
    ),
  },
  hackathon: {
    gradient: 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)',
    bgCircles: [
      { cx: '80%', cy: '15%', r: '85', fill: 'rgba(255,255,255,0.07)' },
      { cx: '20%', cy: '80%', r: '65', fill: 'rgba(255,255,255,0.05)' },
      { cx: '50%', cy: '40%', r: '45', fill: 'rgba(255,255,255,0.04)' },
    ],
    icon: (
      <g transform="translate(12, 12)">
        <line x1="24" y1="56" x2="24" y2="36" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
        <line x1="24" y1="36" x2="16" y2="28" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <line x1="24" y1="36" x2="32" y2="28" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <line x1="40" y1="56" x2="40" y2="24" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
        <line x1="40" y1="24" x2="32" y2="16" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <line x1="40" y1="24" x2="48" y2="16" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      </g>
    ),
  },
  gaming: {
    gradient: 'linear-gradient(135deg, #BE123C 0%, #FB923C 100%)',
    bgCircles: [
      { cx: '15%', cy: '15%', r: '90', fill: 'rgba(255,255,255,0.06)' },
      { cx: '80%', cy: '75%', r: '80', fill: 'rgba(255,255,255,0.05)' },
      { cx: '50%', cy: '50%', r: '50', fill: 'rgba(255,255,255,0.04)' },
    ],
    icon: (
      <g transform="translate(12, 12)">
        <rect x="8" y="20" width="48" height="32" rx="8" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
        <rect x="12" y="24" width="18" height="16" rx="4" fill="rgba(255,255,255,0.15)" />
        <rect x="34" y="24" width="18" height="16" rx="4" fill="rgba(255,255,255,0.15)" />
        <circle cx="21" cy="32" r="3" fill="rgba(255,255,255,0.6)" />
        <circle cx="43" cy="32" r="3" fill="rgba(255,255,255,0.6)" />
        <line x1="28" y1="48" x2="36" y2="48" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" />
      </g>
    ),
  },
  coding: {
    gradient: 'linear-gradient(135deg, #3730A3 0%, #6366F1 100%)',
    bgCircles: [
      { cx: '18%', cy: '82%', r: '85', fill: 'rgba(255,255,255,0.06)' },
      { cx: '75%', cy: '10%', r: '70', fill: 'rgba(255,255,255,0.05)' },
      { cx: '55%', cy: '60%', r: '55', fill: 'rgba(255,255,255,0.04)' },
    ],
    icon: (
      <g transform="translate(12, 12)">
        <path d="M16 18 L6 32 L16 46" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M48 18 L58 32 L48 46" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="36" y1="16" x2="28" y2="48" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      </g>
    ),
  },
  sports: {
    gradient: 'linear-gradient(135deg, #DC2626 0%, #F97316 100%)',
    bgCircles: [
      { cx: '82%', cy: '18%', r: '75', fill: 'rgba(255,255,255,0.06)' },
      { cx: '18%', cy: '75%', r: '60', fill: 'rgba(255,255,255,0.05)' },
      { cx: '40%', cy: '30%', r: '50', fill: 'rgba(255,255,255,0.04)' },
    ],
    icon: (
      <g transform="translate(12, 12)">
        <circle cx="32" cy="28" r="14" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
        <path d="M24 40 Q32 48 40 40" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <line x1="32" y1="14" x2="32" y2="8" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
        <line x1="28" y1="8" x2="36" y2="8" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      </g>
    ),
  },
};

const defaultTheme = coverThemes.design;

export default function CommunityCoverArt({ coverTheme, className }) {
  const theme = coverThemes[coverTheme] || defaultTheme;

  return (
    <svg
      viewBox="0 0 80 80"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <linearGradient id={`cg-${coverTheme || 'default'}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={theme.gradient.match(/#[A-Fa-f0-9]{6}/g)?.[0] || '#2563EB'} />
          <stop offset="100%" stopColor={theme.gradient.match(/#[A-Fa-f0-9]{6}/g)?.[1] || '#3B82F6'} />
        </linearGradient>
      </defs>
      <rect width="80" height="80" fill={`url(#cg-${coverTheme || 'default'})`} />
      {theme.bgCircles.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill={c.fill} />
      ))}
      {theme.icon}
    </svg>
  );
}
