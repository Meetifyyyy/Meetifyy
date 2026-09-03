import React from 'react';

/**
 * High-quality, tasteful 3D-style vector icons designed specifically for Meetifyy.
 * Features subtle depth, specular lighting highlights, refined gradients,
 * and ambient occlusion shadows without cartoonish exaggeration.
 */

export function Calendar3DIcon({ size = 28, className = '', style }) {
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
        {/* Ambient Ground Shadow */}
        <filter id="cal3d_shadow" x="0" y="4" width="32" height="28" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2" floodColor="#0F172A" floodOpacity="0.16" />
        </filter>

        {/* Base Page Gradient */}
        <linearGradient id="cal3d_base" x1="6" y1="9" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="60%" stopColor="#F8FAFC" />
          <stop offset="100%" stopColor="#E2E8F0" />
        </linearGradient>

        {/* Calendar Header Accent Gradient (Meetifyy Crimson) */}
        <linearGradient id="cal3d_header" x1="4" y1="6" x2="28" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DC2626" />
          <stop offset="35%" stopColor="#B91C1C" />
          <stop offset="100%" stopColor="#8F0C13" />
        </linearGradient>

        {/* Specular Highlight on Header */}
        <linearGradient id="cal3d_header_specular" x1="5" y1="6.5" x2="27" y2="6.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.05" />
        </linearGradient>

        {/* Metallic Binder Ring Gradient */}
        <linearGradient id="cal3d_ring" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F1F5F9" />
          <stop offset="45%" stopColor="#94A3B8" />
          <stop offset="70%" stopColor="#64748B" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </linearGradient>

        {/* 3D Inner Edge Bevel */}
        <linearGradient id="cal3d_bevel" x1="16" y1="25" x2="16" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E2E8F0" stopOpacity="0" />
          <stop offset="100%" stopColor="#CBD5E1" stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {/* Main Calendar Body with Ground Shadow */}
      <g filter="url(#cal3d_shadow)">
        {/* Bottom Page Shadow Sheet */}
        <rect x="5.5" y="10" width="21" height="17.5" rx="4.5" fill="#CBD5E1" />
        
        {/* Main Base Card */}
        <rect x="5" y="9" width="22" height="17.5" rx="4.5" fill="url(#cal3d_base)" />
        
        {/* Bottom Bevel Thickness */}
        <path d="M 5 22 Q 5 26.5 9.5 26.5 L 22.5 26.5 Q 27 26.5 27 22 L 27 21 Q 27 25.5 22.5 25.5 L 9.5 25.5 Q 5 25.5 5 21 Z" fill="url(#cal3d_bevel)" />

        {/* Top Header Bar */}
        <path
          d="M 5 13.5 L 5 12 Q 5 7.5 9.5 7.5 L 22.5 7.5 Q 27 7.5 27 12 L 27 13.5 Z"
          fill="url(#cal3d_header)"
        />
        
        {/* Top Header Specular Rim */}
        <path
          d="M 9.5 8.5 L 22.5 8.5"
          stroke="url(#cal3d_header_specular)"
          strokeWidth="0.9"
          strokeLinecap="round"
        />

        {/* Grid Dots / Schedule Mark */}
        <circle cx="10" cy="17" r="1.3" fill="#94A3B8" />
        <circle cx="16" cy="17" r="1.3" fill="#94A3B8" />
        <circle cx="22" cy="17" r="1.3" fill="#DC2626" />
        <circle cx="10" cy="21.5" r="1.3" fill="#94A3B8" />
        <circle cx="16" cy="21.5" r="1.3" fill="#94A3B8" />
        <circle cx="22" cy="21.5" r="1.3" fill="#94A3B8" />
      </g>

      {/* Binder Ring 1 (Left) */}
      <rect x="9.5" y="4.5" width="2.4" height="6" rx="1.2" fill="url(#cal3d_ring)" />
      <rect x="9.9" y="5.2" width="0.7" height="3" rx="0.35" fill="#FFFFFF" fillOpacity="0.7" />

      {/* Binder Ring 2 (Right) */}
      <rect x="20.1" y="4.5" width="2.4" height="6" rx="1.2" fill="url(#cal3d_ring)" />
      <rect x="20.5" y="5.2" width="0.7" height="3" rx="0.35" fill="#FFFFFF" fillOpacity="0.7" />
    </svg>
  );
}

export function Clock3DIcon({ size = 28, className = '', style }) {
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
        {/* Ambient Ground Shadow */}
        <filter id="clock3d_shadow" x="1" y="2" width="30" height="30" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2" floodColor="#0F172A" floodOpacity="0.16" />
        </filter>

        {/* Outer 3D Bevel Rim Gradient */}
        <linearGradient id="clock3d_rim" x1="5" y1="4" x2="27" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DC2626" />
          <stop offset="40%" stopColor="#B91C1C" />
          <stop offset="100%" stopColor="#7F1D1D" />
        </linearGradient>

        {/* Rim Specular Glare */}
        <linearGradient id="clock3d_rim_specular" x1="16" y1="4" x2="16" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>

        {/* Inner Clock Face Gradient */}
        <radialGradient id="clock3d_face" cx="40%" cy="36%" r="62%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="65%" stopColor="#F8FAFC" />
          <stop offset="100%" stopColor="#E2E8F0" />
        </radialGradient>

        {/* Hands Gradient */}
        <linearGradient id="clock3d_hands" x1="16" y1="9" x2="16" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E293B" />
          <stop offset="100%" stopColor="#0F172A" />
        </linearGradient>
      </defs>

      <g filter="url(#clock3d_shadow)">
        {/* Outer 3D Rim */}
        <circle cx="16" cy="15.5" r="12" fill="url(#clock3d_rim)" />
        <ellipse cx="16" cy="5.5" rx="7" ry="1.5" fill="url(#clock3d_rim_specular)" />

        {/* Inner Face */}
        <circle cx="16" cy="15.5" r="9.5" fill="url(#clock3d_face)" />

        {/* Hour Markers (12, 3, 6, 9) */}
        <circle cx="16" cy="8.2" r="0.9" fill="#94A3B8" />
        <circle cx="23.3" cy="15.5" r="0.9" fill="#94A3B8" />
        <circle cx="16" cy="22.8" r="0.9" fill="#94A3B8" />
        <circle cx="8.7" cy="15.5" r="0.9" fill="#94A3B8" />

        {/* Clock Hands (pointing to 1:15) */}
        <line x1="16" y1="15.5" x2="18.8" y2="11.2" stroke="url(#clock3d_hands)" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="16" y1="15.5" x2="21.5" y2="15.5" stroke="#DC2626" strokeWidth="1.3" strokeLinecap="round" />

        {/* Center Pivot Pin */}
        <circle cx="16" cy="15.5" r="1.6" fill="#0F172A" />
        <circle cx="15.6" cy="15.1" r="0.5" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

export function Venue3DIcon({ size = 28, className = '', style }) {
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
        {/* Soft Contact Ground Shadow */}
        <radialGradient id="ven3d_shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0F172A" stopOpacity="0.25" />
          <stop offset="60%" stopColor="#0F172A" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#0F172A" stopOpacity="0" />
        </radialGradient>

        {/* 3D Pin Spherical Gradient */}
        <radialGradient id="ven3d_body" cx="38%" cy="30%" r="62%">
          <stop offset="0%" stopColor="#FF6467" />
          <stop offset="35%" stopColor="#E11D48" />
          <stop offset="80%" stopColor="#BE123C" />
          <stop offset="100%" stopColor="#881337" />
        </radialGradient>

        {/* Specular Highlight Gradient */}
        <linearGradient id="ven3d_specular" x1="12" y1="5" x2="15" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.05" />
        </linearGradient>

        {/* Inner Core Shadow */}
        <radialGradient id="ven3d_core_shadow" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#881337" stopOpacity="0.3" />
          <stop offset="80%" stopColor="#4C0519" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#2A030D" stopOpacity="0.95" />
        </radialGradient>

        {/* Core Center Dot */}
        <linearGradient id="ven3d_core_dot" x1="16" y1="11" x2="16" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E2E8F0" />
        </linearGradient>
      </defs>

      {/* Ground Shadow Ellipse */}
      <ellipse cx="16" cy="27.5" rx="6.5" ry="2.2" fill="url(#ven3d_shadow)" />

      {/* Pin 3D Body */}
      <path
        d="M 16 3.5 C 10.477 3.5 6 7.977 6 13.5 C 6 19.8 14.2 26.2 15.35 27.05 C 15.73 27.33 16.27 27.33 16.65 27.05 C 17.8 26.2 26 19.8 26 13.5 C 26 7.977 21.523 3.5 16 3.5 Z"
        fill="url(#ven3d_body)"
      />

      {/* 3D Specular Sheen on Top-Left Dome */}
      <ellipse cx="13.5" cy="8" rx="4.5" ry="2.5" transform="rotate(-25 13.5 8)" fill="url(#ven3d_specular)" />

      {/* Inner Recessed Core (Aperture) */}
      <circle cx="16" cy="13" r="4.2" fill="url(#ven3d_core_shadow)" />

      {/* Inner Polished Pearl Dot */}
      <circle cx="16" cy="13" r="2.8" fill="url(#ven3d_core_dot)" />
      <circle cx="15.2" cy="12.2" r="0.8" fill="#FFFFFF" fillOpacity="0.9" />
    </svg>
  );
}

export function Organizer3DIcon({ size = 28, className = '', style }) {
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
        {/* Soft Drop Shadow */}
        <filter id="org3d_shadow" x="1" y="2" width="30" height="30" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2" floodColor="#0F172A" floodOpacity="0.16" />
        </filter>

        {/* 3D Head Spherical Gradient */}
        <radialGradient id="org3d_head" cx="38%" cy="32%" r="62%">
          <stop offset="0%" stopColor="#FF6467" />
          <stop offset="35%" stopColor="#DC2626" />
          <stop offset="75%" stopColor="#991B1B" />
          <stop offset="100%" stopColor="#66080C" />
        </radialGradient>

        {/* Head Specular Highlight */}
        <linearGradient id="org3d_head_specular" x1="14" y1="5.5" x2="16.5" y2="9.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.05" />
        </linearGradient>

        {/* 3D Torso Gradient */}
        <linearGradient id="org3d_torso" x1="16" y1="16" x2="16" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DC2626" />
          <stop offset="45%" stopColor="#B91C1C" />
          <stop offset="85%" stopColor="#881337" />
          <stop offset="100%" stopColor="#4C0519" />
        </linearGradient>

        {/* Torso Top Shoulder Highlight */}
        <linearGradient id="org3d_shoulder_specular" x1="10" y1="17" x2="22" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFA4A8" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFA4A8" stopOpacity="0.7" />
        </linearGradient>

        {/* Secondary Figure (Collaborator in back) */}
        <radialGradient id="org3d_back_figure" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#94A3B8" />
          <stop offset="70%" stopColor="#64748B" />
          <stop offset="100%" stopColor="#475569" />
        </radialGradient>
      </defs>

      <g filter="url(#org3d_shadow)">
        {/* Background Team Member (Subtle 3D Depth) */}
        <circle cx="21.5" cy="10" r="4.2" fill="url(#org3d_back_figure)" opacity="0.9" />
        <path
          d="M 17 26.5 C 17 21.5 19.8 19.5 24 19.5 C 26.8 19.5 29 21.2 29 26.5"
          fill="url(#org3d_back_figure)"
          opacity="0.9"
        />

        {/* Main Foreground Host Torso */}
        <path
          d="M 4.5 26.5 C 4.5 20 8.8 16.5 14.5 16.5 C 20.2 16.5 24.5 20 24.5 26.5 C 24.5 27.4 23.6 28 22 28 L 7 28 C 5.4 28 4.5 27.4 4.5 26.5 Z"
          fill="url(#org3d_torso)"
        />

        {/* Shoulder Highlight Rim */}
        <path
          d="M 7.5 23 C 9.2 19.2 11.8 17.5 14.5 17.5 C 17.2 17.5 19.8 19.2 21.5 23"
          stroke="url(#org3d_shoulder_specular)"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Main Foreground Host Head */}
        <circle cx="14.5" cy="9.5" r="5.5" fill="url(#org3d_head)" />
        <ellipse cx="12.7" cy="7.2" rx="2.5" ry="1.4" transform="rotate(-25 12.7 7.2)" fill="url(#org3d_head_specular)" />
      </g>
    </svg>
  );
}
