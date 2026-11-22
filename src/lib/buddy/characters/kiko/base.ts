export const KIKO_BASE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="none">
  <defs>
    <linearGradient id="fur" x1="90" y1="70" x2="250" y2="290" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFB067"/>
      <stop offset="1" stop-color="#E06A2B"/>
    </linearGradient>
    <linearGradient id="furShadow" x1="120" y1="140" x2="220" y2="290" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#F28A42"/>
      <stop offset="1" stop-color="#BF4F1A"/>
    </linearGradient>
    <linearGradient id="cream" x1="120" y1="150" x2="210" y2="280" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFF4E7"/>
      <stop offset="1" stop-color="#F3D4B8"/>
    </linearGradient>
  </defs>
  <g id="kiko-root">
    <ellipse id="shadow" cx="160" cy="286" rx="74" ry="14" fill="rgba(20,20,19,0.12)"/>
    <g id="tail-group">
      <path id="tail" d="M222 220c35 2 61-16 66-41 3-15-4-27-16-32-14-6-29 2-33 15-3 10 1 18 8 22-10 12-28 18-48 11z" fill="url(#fur)"/>
      <path id="tail-tip" d="M271 150c10 4 18 15 17 29-10-11-23-17-37-18 5-7 12-11 20-11z" fill="#FFF4E7"/>
    </g>
    <g id="body-group">
      <path id="body" d="M112 176c0-29 22-50 48-50s48 21 48 50v47c0 27-21 46-48 46s-48-19-48-46v-47z" fill="url(#furShadow)"/>
      <path id="belly" d="M131 185c0-20 13-34 29-34s29 14 29 34v34c0 19-13 32-29 32s-29-13-29-32v-34z" fill="url(#cream)"/>
      <path id="paw-left" d="M128 252c0-7 5-12 12-12s12 5 12 12v10c0 6-5 11-12 11s-12-5-12-11v-10z" fill="#F7C9A0"/>
      <path id="paw-right" d="M168 252c0-7 5-12 12-12s12 5 12 12v10c0 6-5 11-12 11s-12-5-12-11v-10z" fill="#F7C9A0"/>
    </g>
    <g id="head-group">
      <g id="ear-left">
        <path d="M108 95l28-34 14 44z" fill="url(#fur)"/>
        <path d="M117 95l17-20 8 26z" fill="#FFD0BE"/>
      </g>
      <g id="ear-right">
        <path d="M212 95l-28-34-14 44z" fill="url(#fur)"/>
        <path d="M203 95l-17-20-8 26z" fill="#FFD0BE"/>
      </g>
      <path id="head" d="M160 72c40 0 70 28 70 66 0 35-25 64-70 64s-70-29-70-64c0-38 30-66 70-66z" fill="url(#fur)"/>
      <path id="face-mask" d="M160 122c20 0 37 12 44 30-6 24-23 40-44 40s-38-16-44-40c7-18 24-30 44-30z" fill="url(#cream)"/>
      <g id="eyes-group">
        <g id="eye-left">
          <ellipse cx="136" cy="132" rx="9" ry="11" fill="#241B18"/>
          <circle id="pupil-left" cx="138" cy="129" r="3.2" fill="#FFFFFF"/>
        </g>
        <g id="eye-right">
          <ellipse cx="184" cy="132" rx="9" ry="11" fill="#241B18"/>
          <circle id="pupil-right" cx="186" cy="129" r="3.2" fill="#FFFFFF"/>
        </g>
      </g>
      <path id="nose" d="M160 148c5 0 10 3 10 7 0 5-5 9-10 9s-10-4-10-9c0-4 5-7 10-7z" fill="#3A2A25"/>
      <path id="mouth" d="M150 165c3 4 6 6 10 6s7-2 10-6" stroke="#3A2A25" stroke-width="3.5" stroke-linecap="round"/>
      <path id="blush-left" d="M117 146c7 0 12 4 12 9s-5 9-12 9-12-4-12-9 5-9 12-9z" fill="rgba(255,140,140,0.28)"/>
      <path id="blush-right" d="M203 146c7 0 12 4 12 9s-5 9-12 9-12-4-12-9 5-9 12-9z" fill="rgba(255,140,140,0.28)"/>
    </g>
    <g id="accessory-group">
      <path id="scarf" d="M118 188c10 10 25 16 42 16s32-6 42-16l-6 20c-9 8-22 12-36 12s-27-4-36-12l-6-20z" fill="#4E8BFF"/>
      <circle cx="196" cy="205" r="6" fill="#FFD76A"/>
    </g>
  </g>
</svg>`;
