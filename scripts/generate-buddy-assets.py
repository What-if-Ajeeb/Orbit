#!/usr/bin/env python3
"""Generate the original ORBIT Buddy SVG packs.

The base artwork for each species is authored here as layered SVG so the
asset contract stays consistent (body-group, head-group, expression groups,
appendage groups). Form variants reuse the same base silhouette with
stage-specific overlays; shiny forms use a documented alternate palette.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "orbit-buddy" / "characters"


def defs(p):
    return f'''<defs>
  <linearGradient id="fur" x1="80" y1="60" x2="250" y2="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{p['fur']}"/><stop offset="1" stop-color="{p['fur2']}"/></linearGradient>
  <linearGradient id="belly" x1="120" y1="140" x2="210" y2="290" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{p['belly']}"/><stop offset="1" stop-color="{p['belly2']}"/></linearGradient>
  <linearGradient id="accent" x1="110" y1="170" x2="220" y2="280" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{p['accent']}"/><stop offset="1" stop-color="{p['accent2']}"/></linearGradient>
</defs>'''


def eyes(cx1, cx2, cy, rx, ry, color, iris=None, style="round"):
    ring = f'<ellipse cx="{cx1}" cy="{cy}" rx="{rx+4}" ry="{ry+4}" fill="{iris}" opacity="0.55"/>' if iris else ""
    ring2 = f'<ellipse cx="{cx2}" cy="{cy}" rx="{rx+4}" ry="{ry+4}" fill="{iris}" opacity="0.55"/>' if iris else ""
    if style == "almond":
        left = f'{ring}<path d="M{cx1-rx} {cy}c{rx//2}-{ry} {rx*3//2}-{ry} {rx*2} 0-{rx//2} {ry} -{rx*3//2} {ry} -{rx*2} 0z" fill="{color}"/>'
        right = f'{ring2}<path d="M{cx2-rx} {cy}c{rx//2}-{ry} {rx*3//2}-{ry} {rx*2} 0-{rx//2} {ry} -{rx*3//2} {ry} -{rx*2} 0z" fill="{color}"/>'
    else:
        left = f'{ring}<ellipse cx="{cx1}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}"/>'
        right = f'{ring2}<ellipse cx="{cx2}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}"/>'
    return f'''<g id="eyes-group">
  <g id="eyes-open">{left}<circle cx="{cx1-rx//3}" cy="{cy-ry//3}" r="{max(2,rx//3)}" fill="#FFFFFF"/>{right}<circle cx="{cx2-rx//3}" cy="{cy-ry//3}" r="{max(2,rx//3)}" fill="#FFFFFF"/></g>
  <g id="eyes-closed" display="none"><path d="M{cx1-rx} {cy}c{rx//2} {ry//2} {rx*3//2} {ry//2} {rx*2} 0" stroke="{color}" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M{cx2-rx} {cy}c{rx//2} {ry//2} {rx*3//2} {ry//2} {rx*2} 0" stroke="{color}" stroke-width="4" stroke-linecap="round" fill="none"/></g>
  <g id="eyes-thinking" display="none"><ellipse cx="{cx1+rx//3}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}"/><ellipse cx="{cx2+rx//3}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}"/><circle cx="{cx1-rx//3}" cy="{cy-ry//3}" r="{max(2,rx//3)}" fill="#FFFFFF"/><circle cx="{cx2-rx//3}" cy="{cy-ry//3}" r="{max(2,rx//3)}" fill="#FFFFFF"/></g>
</g>'''


def mouths(mx, my, color="#3A2A25"):
    return f'''<g id="mouth-idle"><path d="M{mx-10} {my}c4 4 7 6 10 6s6-2 10-6" stroke="{color}" stroke-width="3.5" stroke-linecap="round" fill="none"/></g>
<g id="mouth-happy" display="none"><path d="M{mx-14} {my-2}c5 10 10 13 14 13s9-3 14-13" stroke="{color}" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M{mx-7} {my+3}c3 4 7 5 7 5s4-1 7-5" fill="#F87171"/></g>
<g id="mouth-sad" display="none"><path d="M{mx-10} {my+7}c4-6 7-8 10-8s6 2 10 8" stroke="{color}" stroke-width="3.5" stroke-linecap="round" fill="none"/></g>
<g id="mouth-angry" display="none"><path d="M{mx-12} {my+4}h24" stroke="{color}" stroke-width="3.5" stroke-linecap="round"/></g>
<g id="mouth-thinking" display="none"><circle cx="{mx}" cy="{my+2}" r="4" fill="{color}"/></g>
<g id="mouth-curious" display="none"><ellipse cx="{mx}" cy="{my+2}" rx="5" ry="6" fill="{color}"/></g>
<g id="mouth-speaking" display="none"><ellipse cx="{mx}" cy="{my+4}" rx="8" ry="10" fill="#6B2D2D"/><ellipse cx="{mx}" cy="{my+8}" rx="5" ry="3" fill="#F87171"/></g>
<g id="mouth-sleep" display="none"><path d="M{mx-8} {my+3}c4 3 8 3 12 0" stroke="{color}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.7"/></g>'''


def flourish(cy=150, cx1=112, cx2=208):
    return f'''<g id="expression-blush" display="none"><ellipse cx="{cx1}" cy="{cy}" rx="14" ry="8" fill="#F87171" opacity="0.35"/><ellipse cx="{cx2}" cy="{cy}" rx="14" ry="8" fill="#F87171" opacity="0.35"/></g>
<g id="expression-sweat" display="none"><path d="M276 108c8 10 12 16 12 22a12 12 0 1 1-24 0c0-6 4-12 12-22z" fill="#7DD3FC" opacity="0.9"/></g>
<g id="expression-sparkle" display="none"><path d="M92 72l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" fill="#FDE68A"/><path d="M244 86l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FDE68A"/></g>'''


def head(inner_ears, main, ex):
    return f'''<g id="head-group">
{inner_ears}
{main}
{ex}
{flourish()}
</g>'''


SPECS = {}

# ---------------------------------------------------------------- Raven
p = dict(fur="#343A54", fur2="#1B1E2E", belly="#646C88", belly2="#3E455E", accent="#7C3AED", accent2="#4C1D95")
SPECS["raven"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M112 172c0-34 21-58 48-58s48 24 48 58v52c0 30-21 48-48 48s-48-18-48-48z" fill="url(#fur)"/>
<path d="M136 180c0-22 10-38 24-38s24 16 24 38v46c0 20-10 32-24 32s-24-12-24-32z" fill="url(#belly)" opacity="0.85"/>
<path d="M126 264c0-6 5-11 11-11s11 5 11 11v10c0 6-5 10-11 10s-11-4-11-10z" fill="#C28A3D"/>
<path d="M172 264c0-6 5-11 11-11s11 5 11 11v10c0 6-5 10-11 10s-11-4-11-10z" fill="#C28A3D"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M116 92l-16-40 40 22z" fill="url(#fur)"/><path d="M115 86l-8-22 22 12z" fill="#8B93B0"/></g>
<g id="ear-right-group"><path d="M204 92l16-40-40 22z" fill="url(#fur)"/><path d="M205 86l8-22-22 12z" fill="#8B93B0"/></g>''',
    headmain='''<path d="M160 62c36 0 62 24 62 58 0 36-26 58-62 58s-62-22-62-58c0-34 26-58 62-58z" fill="url(#fur)"/>
<path d="M160 108c18 0 32 10 38 26-6 20-20 32-38 32s-32-12-38-32c6-16 20-26 38-26z" fill="#5A6178" opacity="0.55"/>
<path d="M160 132l30 14-30 14-30-14z" fill="#E8B44A"/>
<path d="M160 138l18 8-18 8-18-8z" fill="#F7D488" opacity="0.7"/>
''',
    eyecfg=dict(cx1=134, cx2=186, cy=124, rx=9, ry=11, color="#F4B942", iris=None, style="almond"),
    mouthxy=(160, 172),
    appendages={
        "wing-left-group": '<path d="M112 178c-32 6-50 28-46 58 3 20 18 34 36 34l22-56z" fill="url(#fur)"/><path d="M108 194c-18 8-26 22-24 38" stroke="#8B93B0" stroke-width="3" opacity="0.5"/>',
        "wing-right-group": '<path d="M208 178c32 6 50 28 46 58-3 20-18 34-36 34l-22-56z" fill="url(#fur)"/><path d="M212 194c18 8 26 22 24 38" stroke="#8B93B0" stroke-width="3" opacity="0.5"/>',
        "tail-group": '<path d="M140 278l-18 34 22-6 16 14 16-14 22 6-18-34z" fill="#252A3D"/><path d="M150 280l-8 22 10-4 8 8 8-8 10 4-8-22z" fill="#4A5270"/>',
    },
    accessory='<g id="accessory-group"><path d="M120 186c10 10 24 16 40 16s30-6 40-16l-5 18c-9 8-21 12-35 12s-26-4-35-12z" fill="url(#accent)"/><circle cx="196" cy="204" r="6" fill="#FDE68A"/></g>',
    stage2='<g id="evolution-stage2"><path d="M100 58l30-14 30 14-30 10z" fill="#C4B5FD" opacity="0.9"/><path d="M160 44l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" fill="#FDE68A"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="118" fill="none" stroke="#A78BFA" stroke-width="3" stroke-dasharray="6 10" opacity="0.55"/><circle cx="62" cy="120" r="4" fill="#FDE68A"/><circle cx="262" cy="186" r="5" fill="#C4B5FD"/></g>',
    mythical='<g id="evolution-mythical"><path d="M110 66l-18-34 34 8z" fill="#7C3AED"/><path d="M210 66l18-34-34 8z" fill="#7C3AED"/><circle cx="160" cy="40" r="10" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M160 22l3 10 10 3-10 3-3 10-3-10-10-3 10-3z" fill="#FDE68A"/></g>',
)

# ---------------------------------------------------------------- Owl
p = dict(fur="#C9A27E", fur2="#8C6647", belly="#F6E8D6", belly2="#E3CBB2", accent="#3B82F6", accent2="#1D4ED8")
SPECS["owl"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M160 142c46 0 72 32 72 72 0 40-32 64-72 64s-72-24-72-64c0-40 26-72 72-72z" fill="url(#fur)"/>
<path d="M160 168c30 0 48 20 48 46 0 28-20 44-48 44s-48-16-48-44c0-26 18-46 48-46z" fill="url(#belly)"/>
<path d="M128 214c8-6 16-6 24 0M144 238c8-6 16-6 24 0M168 214c8-6 16-6 24 0" stroke="#D6B99B" stroke-width="3" fill="none" opacity="0.8"/>
<path d="M132 266c0-6 5-10 11-10s11 4 11 10v8c0 6-5 10-11 10s-11-4-11-10z" fill="#E8A33D"/>
<path d="M166 266c0-6 5-10 11-10s11 4 11 10v8c0 6-5 10-11 10s-11-4-11-10z" fill="#E8A33D"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M108 84l-14-42 38 24z" fill="url(#fur)"/><path d="M106 78l-6-24 20 14z" fill="#E3CBB2"/></g>
<g id="ear-right-group"><path d="M212 84l14-42-38 24z" fill="url(#fur)"/><path d="M214 78l6-24-20 14z" fill="#E3CBB2"/></g>''',
    headmain='''<path d="M160 52c40 0 70 30 70 68 0 38-30 66-70 66s-70-28-70-66c0-38 30-68 70-68z" fill="url(#fur)"/>
<circle cx="132" cy="122" r="26" fill="#F6E8D6"/><circle cx="188" cy="122" r="26" fill="#F6E8D6"/>
<path d="M160 138l12 12-12 12-12-12z" fill="#E8A33D"/>
''',
    eyecfg=dict(cx1=132, cx2=188, cy=122, rx=12, ry=12, color="#2B2118", iris="#F4B942", style="round"),
    mouthxy=(160, 166),
    appendages={
        "wing-left-group": '<path d="M118 178c-26 10-36 34-30 58 5 20 20 32 38 28l10-62z" fill="#A77B57"/>',
        "wing-right-group": '<path d="M202 178c26 10 36 34 30 58-5 20-20 32-38 28l-10-62z" fill="#A77B57"/>',
    },
    accessory='<g id="accessory-group"><path d="M116 190c10 10 26 16 44 16s34-6 44-16l-5 20c-10 8-24 12-39 12s-29-4-39-12z" fill="url(#accent)"/><circle cx="160" cy="222" r="6" fill="#FDE68A"/></g>',
    stage2='<g id="evolution-stage2"><circle cx="132" cy="122" r="20" fill="none" stroke="#FDE68A" stroke-width="3"/><circle cx="188" cy="122" r="20" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M152 122h16" stroke="#FDE68A" stroke-width="3"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="140" r="112" fill="none" stroke="#93C5FD" stroke-width="3" stroke-dasharray="4 10" opacity="0.55"/><path d="M60 96l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M104 60l-10-34 26 16z" fill="#60A5FA"/><path d="M216 60l10-34-26 16z" fill="#60A5FA"/><circle cx="160" cy="30" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M118 52c10-18 26-26 42-26s32 8 42 26" stroke="#FDE68A" stroke-width="3" fill="none"/></g>',
)

# ---------------------------------------------------------------- Bear
p = dict(fur="#A97142", fur2="#7A4E2D", belly="#E7C29E", belly2="#D2A57C", accent="#2563EB", accent2="#1E40AF")
SPECS["bear"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M108 168c0-34 23-56 52-56s52 22 52 56v56c0 30-22 50-52 50s-52-20-52-50z" fill="url(#fur)"/>
<path d="M132 180c0-20 12-34 28-34s28 14 28 34v42c0 20-12 32-28 32s-28-12-28-32z" fill="url(#belly)"/>
<path d="M122 260c0-7 6-12 13-12s13 5 13 12v12c0 6-6 10-13 10s-13-4-13-10z" fill="#8A5A34"/>
<path d="M172 260c0-7 6-12 13-12s13 5 13 12v12c0 6-6 10-13 10s-13-4-13-10z" fill="#8A5A34"/>
</g>''',
    ears='''<g id="ear-left-group"><circle cx="112" cy="72" r="22" fill="#8A5A34"/><circle cx="112" cy="72" r="12" fill="#D9A97E"/></g>
<g id="ear-right-group"><circle cx="208" cy="72" r="22" fill="#8A5A34"/><circle cx="208" cy="72" r="12" fill="#D9A97E"/></g>''',
    headmain='''<path d="M160 62c38 0 64 26 64 60 0 36-26 60-64 60s-64-24-64-60c0-34 26-60 64-60z" fill="url(#fur)"/>
<ellipse cx="160" cy="148" rx="34" ry="25" fill="url(#belly)"/>
<path d="M160 138c8 0 15 4 15 9s-7 9-15 9-15-4-15-9 7-9 15-9z" fill="#3A2A25"/>
''',
    eyecfg=dict(cx1=136, cx2=184, cy=124, rx=8, ry=9, color="#2B2118", iris=None, style="round"),
    mouthxy=(160, 162),
    appendages={"tail-group": '<circle cx="202" cy="244" r="16" fill="#8A5A34"/>'},
    accessory='<g id="accessory-group"><path d="M118 190c10 10 25 15 42 15s32-5 42-15l-6 20c-9 8-21 12-36 12s-27-4-36-12z" fill="url(#accent)"/><circle cx="198" cy="208" r="6" fill="#FDE68A"/></g>',
    stage2='<g id="evolution-stage2"><path d="M110 186c-12 10-16 26-10 40l26-8 8-28z" fill="#94A3B8"/><path d="M210 186c12 10 16 26 10 40l-26-8-8-28z" fill="#94A3B8"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="116" fill="none" stroke="#93C5FD" stroke-width="3" stroke-dasharray="6 10" opacity="0.5"/><path d="M64 100l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M116 72c-10-24-2-44 14-52 4 16 14 26 30 32" fill="#94A3B8" stroke="#475569" stroke-width="3"/><path d="M204 72c10-24 2-44-14-52-4 16-14 26-30 32" fill="#94A3B8" stroke="#475569" stroke-width="3"/><circle cx="160" cy="32" r="10" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Wolf
p = dict(fur="#8E9AAB", fur2="#4B5563", belly="#E5E7EB", belly2="#CBD5E1", accent="#6366F1", accent2="#4338CA")
SPECS["wolf"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M112 170c0-32 22-54 48-54s48 22 48 54v52c0 28-21 48-48 48s-48-20-48-48z" fill="url(#fur)"/>
<path d="M136 180c0-20 11-34 24-34s24 14 24 34v42c0 20-11 32-24 32s-24-12-24-32z" fill="url(#belly)"/>
<path d="M160 178l-16 22 16 14 16-14z" fill="#CBD5E1" opacity="0.7"/>
<path d="M126 262c0-6 5-11 11-11s11 5 11 11v10c0 6-5 10-11 10s-11-4-11-10z" fill="#374151"/>
<path d="M172 262c0-6 5-11 11-11s11 5 11 11v10c0 6-5 10-11 10s-11-4-11-10z" fill="#374151"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M114 92l-18-46 42 26z" fill="url(#fur)"/><path d="M112 86l-9-26 24 15z" fill="#CBD5E1"/></g>
<g id="ear-right-group"><path d="M206 92l18-46-42 26z" fill="url(#fur)"/><path d="M208 86l9-26-24 15z" fill="#CBD5E1"/></g>''',
    headmain='''<path d="M160 60c34 0 60 22 60 54 0 24-12 42-30 52l-30 16-30-16c-18-10-30-28-30-52 0-32 26-54 60-54z" fill="url(#fur)"/>
<path d="M160 128c18 0 32 8 40 22-8 18-22 28-40 28s-32-10-40-28c8-14 22-22 40-22z" fill="url(#belly)"/>
<path d="M160 142c7 0 13 4 13 9s-6 9-13 9-13-4-13-9 6-9 13-9z" fill="#1F2937"/>
''',
    eyecfg=dict(cx1=134, cx2=186, cy=120, rx=9, ry=10, color="#F4B942", iris=None, style="almond"),
    mouthxy=(160, 160),
    appendages={"tail-group": '<path d="M206 230c34 0 54-22 50-48-3-20-18-30-32-24-12 5-16 18-9 28-8 12-20 18-34 16z" fill="url(#fur)"/><path d="M246 174c8 8 10 20 6 30-8-8-18-12-28-12 4-8 12-16 22-18z" fill="#E5E7EB"/>'},
    accessory='<g id="accessory-group"><path d="M120 190c10 10 25 15 40 15s30-5 40-15l-5 18c-9 8-21 12-35 12s-26-4-35-12z" fill="url(#accent)"/><path d="M160 206l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    stage2='<g id="evolution-stage2"><path d="M160 54c-14 10-22 24-22 40 10-6 16-14 22-24 6 10 12 18 22 24 0-16-8-30-22-40z" fill="#A5B4FC" opacity="0.8"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="118" fill="none" stroke="#A5B4FC" stroke-width="3" stroke-dasharray="5 11" opacity="0.55"/><circle cx="58" cy="138" r="3" fill="#FDE68A"/><circle cx="262" cy="120" r="4" fill="#A5B4FC"/></g>',
    mythical='<g id="evolution-mythical"><path d="M122 70c-8-22-2-40 12-50 4 14 12 24 26 30" fill="#C7D2FE" stroke="#6366F1" stroke-width="3"/><circle cx="160" cy="30" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M160 18l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FDE68A"/></g>',
)

# ---------------------------------------------------------------- Deer
p = dict(fur="#C98F5B", fur2="#9A6438", belly="#F7E7D3", belly2="#EAD3B8", accent="#10B981", accent2="#047857")
SPECS["deer"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M124 168c0-30 16-50 36-50s36 20 36 50v56c0 26-16 46-36 46s-36-20-36-46z" fill="url(#fur)"/>
<path d="M142 182c0-18 8-30 18-30s18 12 18 30v40c0 18-8 28-18 28s-18-10-18-28z" fill="url(#belly)"/>
<circle cx="116" cy="212" r="7" fill="#F7E7D3" opacity="0.9"/><circle cx="204" cy="222" r="6" fill="#F7E7D3" opacity="0.9"/><circle cx="122" cy="244" r="5" fill="#F7E7D3" opacity="0.9"/>
<path d="M132 266c0-6 5-10 10-10s10 4 10 10v8c0 6-5 10-10 10s-10-4-10-10z" fill="#7C4A26"/>
<path d="M168 266c0-6 5-10 10-10s10 4 10 10v8c0 6-5 10-10 10s-10-4-10-10z" fill="#7C4A26"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M112 92c-24-10-42 2-46 22 16 8 34 6 50-4z" fill="url(#fur)"/><path d="M108 96c-14-4-24 2-28 12 10 2 20 0 30-4z" fill="#F2CDAA"/></g>
<g id="ear-right-group"><path d="M208 92c24-10 42 2 46 22-16 8-34 6-50-4z" fill="url(#fur)"/><path d="M212 96c14-4 24 2 28 12-10 2-20 0-30-4z" fill="#F2CDAA"/></g>''',
    headmain='''<path d="M160 74c28 0 50 20 50 46 0 28-22 48-50 48s-50-20-50-48c0-26 22-46 50-46z" fill="url(#fur)"/>
<path d="M160 118c16 0 28 8 34 20-6 16-18 26-34 26s-28-10-34-26c6-12 18-20 34-20z" fill="url(#belly)"/>
<path d="M160 136c6 0 11 3 11 7s-5 7-11 7-11-3-11-7 5-7 11-7z" fill="#3B2A1A"/>
<path d="M116 52c-10-18-10-34 0-46 4 14 10 24 20 30M124 34l-18-2M204 52c10-18 10-34 0-46-4 14-10 24-20 30M196 34l18-2" stroke="#7C4A26" stroke-width="4" stroke-linecap="round" fill="none"/>
''',
    eyecfg=dict(cx1=138, cx2=182, cy=112, rx=8, ry=10, color="#3B2A1A", iris=None, style="round"),
    mouthxy=(160, 150),
    appendages={"tail-group": '<path d="M118 232c-18 8-26 22-22 38 4 12 16 18 28 14l10-32z" fill="#F7E7D3"/><path d="M124 234c-8 8-12 18-10 28" stroke="#EAD3B8" stroke-width="4"/>'},
    accessory='<g id="accessory-group"><path d="M124 190c10 10 22 14 36 14s26-4 36-14l-5 18c-8 8-19 12-31 12s-23-4-31-12z" fill="url(#accent)"/><path d="M160 192c6 0 12 4 12 10s-6 10-12 10-12-4-12-10 6-10 12-10z" fill="#FDE68A" opacity="0.9"/></g>',
    stage2='<g id="evolution-stage2"><path d="M104 54c-12-14-14-28-8-40 8 10 16 16 28 18M216 54c12-14 14-28 8-40-8 10-16 16-28 18" stroke="#10B981" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="92" cy="24" r="6" fill="#FDE68A"/><circle cx="228" cy="24" r="6" fill="#FDE68A"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="118" fill="none" stroke="#6EE7B7" stroke-width="3" stroke-dasharray="4 10" opacity="0.55"/><path d="M56 108l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M114 62c-16-18-20-36-12-50 10 14 20 22 34 26M206 62c16-18 20-36 12-50-10 14-20 22-34 26" stroke="#6EE7B7" stroke-width="4" fill="none"/><circle cx="160" cy="34" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M136 34c8-10 16-14 24-14s16 4 24 14" stroke="#FDE68A" stroke-width="3" fill="none"/></g>',
)

# ---------------------------------------------------------------- Labrador
p = dict(fur="#E8B84B", fur2="#C98A24", belly="#FFF1C9", belly2="#F5D98F", accent="#3B82F6", accent2="#1D4ED8")
SPECS["labrador"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M110 170c0-32 22-54 50-54s50 22 50 54v54c0 30-22 50-50 50s-50-20-50-50z" fill="url(#fur)"/>
<path d="M134 182c0-20 11-34 26-34s26 14 26 34v42c0 20-11 32-26 32s-26-12-26-32z" fill="url(#belly)"/>
<path d="M124 262c0-7 6-12 13-12s13 5 13 12v10c0 6-6 10-13 10s-13-4-13-10z" fill="#B8791B"/>
<path d="M170 262c0-7 6-12 13-12s13 5 13 12v10c0 6-6 10-13 10s-13-4-13-10z" fill="#B8791B"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M116 92c-26 2-40 24-36 52 3 20 16 32 30 28l14-58z" fill="#D89B2C"/><path d="M114 104c-14 6-20 20-18 34 2 10 8 16 16 14l8-40z" fill="#F5D489"/></g>
<g id="ear-right-group"><path d="M204 92c26 2 40 24 36 52-3 20-16 32-30 28l-14-58z" fill="#D89B2C"/><path d="M206 104c14 6 20 20 18 34-2 10-8 16-16 14l-8-40z" fill="#F5D489"/></g>''',
    headmain='''<path d="M160 64c36 0 60 24 60 56 0 34-24 58-60 58s-60-24-60-58c0-32 24-56 60-56z" fill="url(#fur)"/>
<path d="M160 126c20 0 34 10 40 24-8 18-22 28-40 28s-32-10-40-28c6-14 20-24 40-24z" fill="url(#belly)"/>
<path d="M160 140c7 0 13 4 13 9s-6 9-13 9-13-4-13-9 6-9 13-9z" fill="#2B2118"/>
<path d="M148 160c8 8 16 10 24 0" stroke="#2B2118" stroke-width="3" stroke-linecap="round" fill="none"/>
''',
    eyecfg=dict(cx1=136, cx2=184, cy=118, rx=8, ry=10, color="#2B2118", iris=None, style="round"),
    mouthxy=(160, 158),
    appendages={"tail-group": '<path d="M202 230c34-6 50-30 44-54-3-16-16-24-28-18-10 5-14 16-8 25-8 10-18 15-30 15z" fill="url(#fur)"/><path d="M238 178c6 8 8 18 4 26-6-8-14-12-22-12 4-8 10-13 18-14z" fill="#FFF1C9"/>'},
    accessory='<g id="accessory-group"><path d="M122 190c9 9 23 14 38 14s29-5 38-14l-4 15c-8 8-20 12-34 12s-26-4-34-12z" fill="url(#accent)"/><circle cx="160" cy="220" r="9" fill="#FDE68A"/><path d="M160 215l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#3B82F6"/></g>',
    stage2='<g id="evolution-stage2"><path d="M112 186l-16 40 18 4 20-38zM208 186l16 40-18 4-20-38z" fill="#93C5FD"/><circle cx="104" cy="234" r="6" fill="#FDE68A"/><circle cx="216" cy="234" r="6" fill="#FDE68A"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="118" fill="none" stroke="#93C5FD" stroke-width="3" stroke-dasharray="5 11" opacity="0.55"/><path d="M58 104l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M112 86c-22-14-32-32-28-50 16 10 30 14 48 12" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/><path d="M208 86c22-14 32-32 28-50-16 10-30 14-48 12" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/><circle cx="160" cy="34" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Dolphin
p = dict(fur="#5BB8E8", fur2="#2A7FB8", belly="#DDF3FF", belly2="#BFE8FF", accent="#F59E0B", accent2="#D97706")
SPECS["dolphin"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M160 92c28 0 46 32 46 76 0 38-14 68-30 84l-16 18-16-18c-16-16-30-46-30-84 0-44 18-76 46-76z" fill="url(#fur)"/>
<path d="M160 142c18 0 30 22 30 48 0 26-10 48-22 60l-8 8-8-8c-12-12-22-34-22-60 0-26 12-48 30-48z" fill="url(#belly)"/>
<path d="M154 72c0-10 6-16 12-16" stroke="#2A7FB8" stroke-width="4" stroke-linecap="round" fill="none"/>
</g>''',
    ears='',
    headmain='''<path d="M160 84c26 0 44 22 44 48 0 24-18 42-44 42s-44-18-44-42c0-26 18-48 44-48z" fill="url(#fur)"/>
<path d="M160 134c18 0 32 8 38 20-8 14-22 20-38 20s-30-6-38-20c6-12 20-20 38-20z" fill="#DDF3FF" opacity="0.75"/>
<path d="M146 100c6-6 14-8 22-8M176 100c6 0 10 2 14 6" stroke="#2A7FB8" stroke-width="2" opacity="0.5" fill="none"/>
''',
    eyecfg=dict(cx1=140, cx2=180, cy=112, rx=5, ry=6, color="#102A43", iris=None, style="round"),
    mouthxy=(160, 140),
    appendages={
        "fin-left-group": '<path d="M116 188c-26 6-42 26-38 46 3 16 16 24 30 20l18-46z" fill="#3B9FD4"/>',
        "fin-right-group": '<path d="M204 188c26 6 42 26 38 46-3 16-16 24-30 20l-18-46z" fill="#3B9FD4"/>',
        "fluke-group": '<path d="M160 264c-22 0-40 10-52 26 18 2 32 8 44 20l8 10 8-10c12-12 26-18 44-20-12-16-30-26-52-26z" fill="#3B9FD4"/>',
    },
    accessory='<g id="accessory-group"><path d="M160 84c0-18 8-30 22-34" stroke="#FDE68A" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M188 42c6 8 10 13 10 18a10 10 0 1 1-20 0c0-5 4-10 10-18z" fill="#7DD3FC"/></g>',
    stage2='<g id="evolution-stage2"><path d="M94 148c-20-8-34-24-36-42 18 4 34 12 46 24M226 148c20-8 34-24 36-42-18 4-34 12-46 24" stroke="#7DD3FC" stroke-width="5" stroke-linecap="round" fill="none"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="120" fill="none" stroke="#7DD3FC" stroke-width="3" stroke-dasharray="4 10" opacity="0.55"/><circle cx="54" cy="120" r="4" fill="#FDE68A"/><circle cx="266" cy="200" r="5" fill="#7DD3FC"/></g>',
    mythical='<g id="evolution-mythical"><path d="M128 70c-8-20-4-36 8-46 6 12 14 20 26 24M192 70c8-20 4-36-8-46-6 12-14 20-26 24" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/><circle cx="160" cy="38" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Beaver
p = dict(fur="#9C6B45", fur2="#6F4426", belly="#D9B48C", belly2="#C49A72", accent="#F59E0B", accent2="#B45309")
SPECS["beaver"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M112 172c0-34 22-56 48-56s48 22 48 56v54c0 30-22 50-48 50s-48-20-48-50z" fill="url(#fur)"/>
<path d="M136 182c0-20 11-34 24-34s24 14 24 34v42c0 20-11 32-24 32s-24-12-24-32z" fill="url(#belly)"/>
<path d="M126 264c0-6 5-11 11-11s11 5 11 11v10c0 6-5 10-11 10s-11-4-11-10z" fill="#5A351A"/>
<path d="M172 264c0-6 5-11 11-11s11 5 11 11v10c0 6-5 10-11 10s-11-4-11-10z" fill="#5A351A"/>
</g>''',
    ears='''<g id="ear-left-group"><circle cx="118" cy="94" r="14" fill="#7F5539"/><circle cx="118" cy="94" r="8" fill="#C49A72"/></g>
<g id="ear-right-group"><circle cx="202" cy="94" r="14" fill="#7F5539"/><circle cx="202" cy="94" r="8" fill="#C49A72"/></g>''',
    headmain='''<path d="M160 66c34 0 60 24 60 56 0 34-26 58-60 58s-60-24-60-58c0-32 26-56 60-56z" fill="url(#fur)"/>
<path d="M160 130c18 0 32 10 38 24-6 16-20 26-38 26s-32-10-38-26c6-14 20-24 38-24z" fill="url(#belly)"/>
<path d="M160 146c7 0 13 4 13 9s-6 9-13 9-13-4-13-9 6-9 13-9z" fill="#3A2A25"/>
<path d="M150 164h8v14h-8zM162 164h8v14h-8z" fill="#FFF7E8" stroke="#D9B48C" stroke-width="1"/>
''',
    eyecfg=dict(cx1=136, cx2=184, cy=122, rx=7, ry=8, color="#2B2118", iris=None, style="round"),
    mouthxy=(160, 160),
    appendages={"tail-group": '<path d="M204 240c30 2 48 22 44 46-3 18-20 28-38 22l-18-50z" fill="#6F4426"/><path d="M214 250l24 10M210 262l24 10M208 274l22 10" stroke="#9C6B45" stroke-width="4"/>'},
    accessory='<g id="accessory-group"><path d="M118 190c10 10 25 15 42 15s32-5 42-15l-5 16c-9 8-22 12-37 12s-28-4-37-12z" fill="url(#accent)"/><path d="M150 212h20v16h-20z" fill="#FDE68A"/><path d="M154 216h12M154 222h9" stroke="#B45309" stroke-width="2"/></g>',
    stage2='<g id="evolution-stage2"><path d="M112 78c-20-2-34-12-40-28 18 0 34 4 48 14z" fill="#F59E0B"/><path d="M208 78c20-2 34-12 40-28-18 0-34 4-48 14z" fill="#F59E0B"/><circle cx="160" cy="52" r="7" fill="#FDE68A"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="118" fill="none" stroke="#FCD34D" stroke-width="3" stroke-dasharray="6 10" opacity="0.5"/><path d="M58 110l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M118 74c-12-22-8-40 6-52 8 14 18 22 32 26M202 74c12-22 8-40-6-52-8 14-18 22-32 26" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/><circle cx="160" cy="34" r="11" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Elephant
p = dict(fur="#9AA7B8", fur2="#6F7C8C", belly="#D6DEE8", belly2="#BCC8D6", accent="#8B5CF6", accent2="#6D28D9")
SPECS["elephant"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M106 172c0-36 24-58 54-58s54 22 54 58v52c0 30-24 50-54 50s-54-20-54-50z" fill="url(#fur)"/>
<path d="M134 184c0-20 12-34 26-34s26 14 26 34v40c0 20-12 32-26 32s-26-12-26-32z" fill="url(#belly)"/>
<path d="M120 262c0-7 6-12 14-12s14 5 14 12v10c0 6-6 10-14 10s-14-4-14-10z" fill="#5F6B7A"/>
<path d="M172 262c0-7 6-12 14-12s14 5 14 12v10c0 6-6 10-14 10s-14-4-14-10z" fill="#5F6B7A"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M108 92c-34-10-58 8-60 42-2 30 18 48 44 44 12-2 22-14 26-30l4-42z" fill="#7B8794"/><path d="M100 104c-20 0-34 14-34 32 0 16 10 28 24 28 8 0 14-6 16-16z" fill="#B8C4D0"/></g>
<g id="ear-right-group"><path d="M212 92c34-10 58 8 60 42 2 30-18 48-44 44-12-2-22-14-26-30l-4-42z" fill="#7B8794"/><path d="M220 104c20 0 34 14 34 32 0 16-10 28-24 28-8 0-14-6-16-16z" fill="#B8C4D0"/></g>''',
    headmain='''<path d="M160 62c34 0 60 24 60 56 0 28-18 48-42 54l-18 4-18-4c-24-6-42-26-42-54 0-32 26-56 60-56z" fill="url(#fur)"/>
<path d="M160 138c8 0 14 5 14 10s-6 10-14 10-14-5-14-10 6-10 14-10z" fill="#5F6B7A"/>
<path d="M140 160c-2 10-4 18-4 26" stroke="#FDE68A" stroke-width="6" stroke-linecap="round" fill="none"/>
<path d="M180 160c2 10 4 18 4 26" stroke="#FDE68A" stroke-width="6" stroke-linecap="round" fill="none"/>
''',
    eyecfg=dict(cx1=136, cx2=184, cy=118, rx=6, ry=7, color="#1F2937", iris=None, style="round"),
    mouthxy=(160, 154),
    appendages={
        "tail-group": '<path d="M106 230c-18 6-26 20-22 34 3 10 12 14 22 10l8-30z" fill="#7B8794"/>',
        "trunk-group": '<path d="M160 166c-6 18-6 38 2 54 6 12 18 18 30 14 12-4 18-16 14-28-3-8-10-12-18-10 6 8 6 16 0 20-8 6-16-2-16-18 0-12 2-22 6-32z" fill="#7B8794"/><path d="M160 166c-4 16-4 34 2 48" stroke="#B8C4D0" stroke-width="4" stroke-linecap="round" fill="none"/>',
    },
    accessory='<g id="accessory-group"><path d="M118 190c10 10 25 16 42 16s32-6 42-16l-5 18c-9 8-22 12-37 12s-28-4-37-12z" fill="url(#accent)"/><path d="M160 206l5 12 13 5-13 5-5 13-5-13-13-5 13-5z" fill="#FDE68A"/></g>',
    stage2='<g id="evolution-stage2"><path d="M104 78c-18-14-24-32-18-48 14 10 28 14 44 14M216 78c18-14 24-32 18-48-14 10-28 14-44 14" stroke="#C4B5FD" stroke-width="5" stroke-linecap="round" fill="none"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="120" fill="none" stroke="#C4B5FD" stroke-width="3" stroke-dasharray="5 10" opacity="0.55"/><circle cx="52" cy="132" r="4" fill="#FDE68A"/><circle cx="268" cy="116" r="4" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M120 70c-10-22-6-40 8-52 8 14 18 22 32 26M200 70c10-22 6-40-8-52-8 14-18 22-32 26" fill="#FDE68A" stroke="#8B5CF6" stroke-width="3"/><circle cx="160" cy="34" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Lion
p = dict(fur="#E8B23C", fur2="#C07A16", belly="#FBE3A7", belly2="#F5D27A", accent="#DC2626", accent2="#991B1B")
SPECS["lion"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M112 172c0-32 22-54 48-54s48 22 48 54v54c0 30-22 50-48 50s-48-20-48-50z" fill="url(#fur)"/>
<path d="M136 184c0-20 11-34 24-34s24 14 24 34v40c0 20-11 32-24 32s-24-12-24-32z" fill="url(#belly)"/>
<path d="M124 264c0-7 6-12 13-12s13 5 13 12v10c0 6-6 10-13 10s-13-4-13-10z" fill="#A85C0E"/>
<path d="M170 264c0-7 6-12 13-12s13 5 13 12v10c0 6-6 10-13 10s-13-4-13-10z" fill="#A85C0E"/>
</g>''',
    ears='''<g id="ear-left-group"><circle cx="112" cy="82" r="17" fill="#C07A16"/><circle cx="112" cy="82" r="9" fill="#F5D27A"/></g>
<g id="ear-right-group"><circle cx="208" cy="82" r="17" fill="#C07A16"/><circle cx="208" cy="82" r="9" fill="#F5D27A"/></g>''',
    headmain='''<path d="M160 68c34 0 58 24 58 56 0 32-24 56-58 56s-58-24-58-56c0-32 24-56 58-56z" fill="url(#fur)"/>
<path d="M160 132c18 0 32 10 38 24-6 16-20 26-38 26s-32-10-38-26c6-14 20-24 38-24z" fill="url(#belly)"/>
<path d="M160 146c7 0 13 4 13 9s-6 9-13 9-13-4-13-9 6-9 13-9z" fill="#3A2A25"/>
<path d="M126 96c-12-22-4-44 14-52 2 16 10 28 24 34M194 96c12-22 4-44-14-52-2 16-10 28-24 34" fill="#C07A16"/>
''',
    eyecfg=dict(cx1=136, cx2=184, cy=122, rx=8, ry=9, color="#2B2118", iris=None, style="round"),
    mouthxy=(160, 162),
    appendages={"tail-group": '<path d="M204 232c32 2 50 24 46 46-3 16-16 24-28 18l-18-52z" fill="url(#fur)"/><circle cx="250" cy="274" r="12" fill="#A85C0E"/><circle cx="250" cy="274" r="6" fill="#F5D27A"/>'},
    accessory='<g id="accessory-group"><path d="M112 188c12 12 30 18 48 18s36-6 48-18l-8 20c-10 10-24 14-40 14s-30-4-40-14z" fill="url(#accent)"/><circle cx="160" cy="218" r="10" fill="#FDE68A"/><path d="M160 212l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#DC2626"/></g>',
    stage2='<g id="evolution-stage2"><path d="M102 184c-20 14-28 36-22 58l26-10 10-36zM218 184c20 14 28 36 22 58l-26-10-10-36z" fill="#EF4444"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="120" fill="none" stroke="#FCA5A5" stroke-width="3" stroke-dasharray="5 10" opacity="0.55"/><path d="M54 106l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M118 68l-14-38 30 18zM202 68l14-38-30 18z" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/><circle cx="160" cy="32" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M160 20l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FDE68A"/></g>',
)

# ---------------------------------------------------------------- Golden Retriever
p = dict(fur="#F2C14E", fur2="#D99A2B", belly="#FFF0B3", belly2="#F7DD8A", accent="#16A34A", accent2="#15803D")
SPECS["golden-retriever"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M108 170c0-34 23-56 52-56s52 22 52 56v54c0 30-23 50-52 50s-52-20-52-50z" fill="url(#fur)"/>
<path d="M132 182c0-22 12-36 28-36s28 14 28 36v42c0 20-12 32-28 32s-28-12-28-32z" fill="url(#belly)"/>
<path d="M116 236c-10 6-14 18-8 28 6 10 18 12 28 6l6-26zM204 236c10 6 14 18 8 28-6 10-18 12-28 6l-6-26z" fill="#E0A62E"/>
<path d="M122 264c0-7 6-12 13-12s13 5 13 12v10c0 6-6 10-13 10s-13-4-13-10z" fill="#C58A1E"/>
<path d="M172 264c0-7 6-12 13-12s13 5 13 12v10c0 6-6 10-13 10s-13-4-13-10z" fill="#C58A1E"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M118 94c-28 0-44 22-42 50 2 24 16 38 32 34l16-62z" fill="#E0A62E"/><path d="M116 108c-16 4-24 18-22 34 2 12 9 20 18 18l8-44z" fill="#F7DD8A"/></g>
<g id="ear-right-group"><path d="M202 94c28 0 44 22 42 50-2 24-16 38-32 34l-16-62z" fill="#E0A62E"/><path d="M204 108c16 4 24 18 22 34-2 12-9 20-18 18l-8-44z" fill="#F7DD8A"/></g>''',
    headmain='''<path d="M160 64c36 0 60 24 60 56 0 34-24 58-60 58s-60-24-60-58c0-32 24-56 60-56z" fill="url(#fur)"/>
<path d="M160 126c20 0 34 10 40 24-8 18-22 28-40 28s-32-10-40-28c6-14 20-24 40-24z" fill="url(#belly)"/>
<path d="M160 140c7 0 13 4 13 9s-6 9-13 9-13-4-13-9 6-9 13-9z" fill="#2B2118"/>
<path d="M148 160c8 8 16 10 24 0" stroke="#2B2118" stroke-width="3" stroke-linecap="round" fill="none"/>
''',
    eyecfg=dict(cx1=136, cx2=184, cy=118, rx=8, ry=10, color="#2B2118", iris=None, style="round"),
    mouthxy=(160, 158),
    appendages={"tail-group": '<path d="M206 230c38-8 54-34 46-58-3-14-16-20-28-12-10 7-12 20-4 28-10 12-22 18-34 16z" fill="url(#fur)"/><path d="M246 176c6 10 6 22 0 30-4-10-12-16-20-18 4-8 12-12 20-12z" fill="#FFF0B3"/>'},
    accessory='<g id="accessory-group"><path d="M120 190c10 10 25 15 40 15s30-5 40-15l-5 18c-9 8-21 12-35 12s-26-4-35-12z" fill="url(#accent)"/><path d="M160 214c9 0 16 7 16 16s-7 16-16 16-16-7-16-16 7-16 16-16z" fill="#FDE68A"/><path d="M160 220c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9z" fill="#16A34A"/></g>',
    stage2='<g id="evolution-stage2"><path d="M100 184c-16 16-22 38-14 58l24-8 8-38zM220 184c16 16 22 38 14 58l-24-8-8-38z" fill="#FDE68A"/><circle cx="160" cy="214" r="10" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="120" fill="none" stroke="#FDE68A" stroke-width="3" stroke-dasharray="5 10" opacity="0.55"/><path d="M54 104l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M110 78c-22-10-34-28-32-48 16 10 32 14 50 10M210 78c22-10 34-28 32-48-16 10-32 14-50 10" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/><circle cx="160" cy="32" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Cat
p = dict(fur="#B7AA9B", fur2="#7C6B5B", belly="#F5EDE4", belly2="#E7D9C9", accent="#EC4899", accent2="#BE185D")
SPECS["cat"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M118 168c0-30 18-50 42-50s42 20 42 50v58c0 28-18 48-42 48s-42-20-42-48z" fill="url(#fur)"/>
<path d="M140 182c0-20 9-34 20-34s20 14 20 34v42c0 18-9 30-20 30s-20-12-20-30z" fill="url(#belly)"/>
<path d="M130 266c0-6 5-11 10-11s10 5 10 11v8c0 6-5 10-10 10s-10-4-10-10z" fill="#6B5A4B"/>
<path d="M170 266c0-6 5-11 10-11s10 5 10 11v8c0 6-5 10-10 10s-10-4-10-10z" fill="#6B5A4B"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M124 96l-18-48 46 28z" fill="url(#fur)"/><path d="M123 90l-9-25 24 14z" fill="#F2C9B8"/></g>
<g id="ear-right-group"><path d="M196 96l18-48-46 28z" fill="url(#fur)"/><path d="M197 90l9-25-24 14z" fill="#F2C9B8"/></g>''',
    headmain='''<path d="M160 66c34 0 58 24 58 54 0 34-24 56-58 56s-58-22-58-56c0-30 24-54 58-54z" fill="url(#fur)"/>
<path d="M160 128c18 0 32 8 38 22-6 16-20 26-38 26s-32-10-38-26c6-14 20-22 38-22z" fill="url(#belly)"/>
<path d="M160 142c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z" fill="#E58A9A"/>
<path d="M112 144h28M112 154h26M208 144h-28M208 154h-26" stroke="#F5EDE4" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
''',
    eyecfg=dict(cx1=138, cx2=182, cy=118, rx=8, ry=10, color="#3BA55D", iris=None, style="almond"),
    mouthxy=(160, 160),
    appendages={"tail-group": '<path d="M204 238c28 6 42 28 34 50-6 16-22 20-34 10-8-8-8-20 0-26-8-10-10-22-6-32z" fill="url(#fur)"/><path d="M232 280c8 4 10 12 6 18-6-2-10-6-12-12z" fill="#7C6B5B"/>'},
    accessory='<g id="accessory-group"><path d="M124 184c10 8 22 12 36 12s26-4 36-12l-3 12c-8 7-20 11-33 11s-25-4-33-11z" fill="url(#accent)"/><circle cx="160" cy="202" r="8" fill="#FDE68A"/><circle cx="160" cy="202" r="3" fill="#BE185D"/></g>',
    stage2='<g id="evolution-stage2"><path d="M132 104l8 14-10 8-8-14zM188 104l-8 14 10 8 8-14z" fill="#F9A8D4" opacity="0.9"/></g>',
    stage3='<g id="evolution-stage3"><path d="M96 150c-12-18-10-38 6-52 4 18 14 32 30 40" fill="none" stroke="#F9A8D4" stroke-width="4" stroke-linecap="round" opacity="0.8"/><path d="M224 150c12-18 10-38-6-52-4 18-14 32-30 40" fill="none" stroke="#F9A8D4" stroke-width="4" stroke-linecap="round" opacity="0.8"/></g>',
    mythical='<g id="evolution-mythical"><path d="M120 70l-14-38 32 20zM200 70l14-38-32 20z" fill="#FBCFE8" stroke="#EC4899" stroke-width="3"/><circle cx="160" cy="34" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Panda
p = dict(fur="#F5F5F4", fur2="#D6D3D1", belly="#FFFFFF", belly2="#F1EFEC", accent="#22C55E", accent2="#15803D")
SPECS["panda"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M104 172c0-38 25-62 56-62s56 24 56 62v50c0 32-25 54-56 54s-56-22-56-54z" fill="url(#fur)"/>
<path d="M132 186c0-22 12-38 28-38s28 16 28 38v38c0 22-12 34-28 34s-28-12-28-34z" fill="url(#belly)"/>
<path d="M100 182c-16 8-24 26-20 44 4 16 18 26 32 20l12-40zM220 182c16 8 24 26 20 44-4 16-18 26-32 20l-12-40z" fill="#292524"/>
<path d="M120 266c0-8 6-14 14-14s14 6 14 14v8c0 6-6 10-14 10s-14-4-14-10zM172 266c0-8 6-14 14-14s14 6 14 14v8c0 6-6 10-14 10s-14-4-14-10z" fill="#292524"/>
</g>''',
    ears='''<g id="ear-left-group"><circle cx="112" cy="78" r="24" fill="#292524"/><circle cx="112" cy="78" r="11" fill="#57534E"/></g>
<g id="ear-right-group"><circle cx="208" cy="78" r="24" fill="#292524"/><circle cx="208" cy="78" r="11" fill="#57534E"/></g>''',
    headmain='''<path d="M160 62c36 0 62 26 62 58 0 34-26 58-62 58s-62-24-62-58c0-32 26-58 62-58z" fill="url(#fur)"/>
<path d="M122 100c8-14 22-20 34-14-4 16-14 28-28 34-10-6-12-12-6-20z" fill="#292524"/>
<path d="M198 100c-8-14-22-20-34-14 4 16 14 28 28 34 10-6 12-12 6-20z" fill="#292524"/>
<path d="M160 142c8 0 14 4 14 9s-6 9-14 9-14-4-14-9 6-9 14-9z" fill="#292524"/>
<path d="M152 160c5 4 11 6 16 0" stroke="#292524" stroke-width="3" stroke-linecap="round" fill="none"/>
''',
    eyecfg=dict(cx1=138, cx2=182, cy=116, rx=7, ry=9, color="#FDE68A", iris=None, style="round"),
    mouthxy=(160, 160),
    appendages={"tail-group": '<circle cx="210" cy="250" r="14" fill="#292524"/>'},
    accessory='<g id="accessory-group"><path d="M116 86c24-10 64-10 88 0" stroke="url(#accent)" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M204 84c22-24 34-50 32-72" stroke="#15803D" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M236 12c-16-2-28 4-34 16 14 4 26 0 34-16zM236 12c4-14 0-26-10-32 0 14-2 24-10 32z" fill="#22C55E"/></g>',
    stage2='<g id="evolution-stage2"><path d="M104 54c0-18 12-30 28-30s28 12 28 30" fill="none" stroke="#86EFAC" stroke-width="5" stroke-linecap="round"/><path d="M200 54c0-18-12-30-28-30s-28 12-28 30" fill="none" stroke="#86EFAC" stroke-width="5" stroke-linecap="round" opacity="0.7"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="158" r="118" fill="none" stroke="#86EFAC" stroke-width="3" stroke-dasharray="6 12" opacity="0.55"/><path d="M160 26l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M118 64c-16-12-24-28-20-44 14 12 28 16 44 14M202 64c16-12 24-28 20-44-14 12-28 16-44 14" fill="#BAE6FD" stroke="#38BDF8" stroke-width="3"/><circle cx="160" cy="34" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/></g>',
)

# ---------------------------------------------------------------- Cheetah
p = dict(fur="#F4C430", fur2="#D97706", belly="#FFF3BF", belly2="#FDE68A", accent="#EF4444", accent2="#B91C1C")
SPECS["cheetah"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M118 166c0-30 18-50 42-50s42 20 42 50v60c0 28-18 48-42 48s-42-20-42-48z" fill="url(#fur)"/>
<path d="M140 182c0-22 9-36 20-36s20 14 20 36v40c0 20-9 32-20 32s-20-12-20-32z" fill="url(#belly)"/>
<circle cx="116" cy="206" r="4" fill="#B45309"/><circle cx="204" cy="218" r="4" fill="#B45309"/><circle cx="124" cy="238" r="3.5" fill="#B45309"/><circle cx="196" cy="246" r="3" fill="#B45309"/>
<path d="M128 266c0-7 5-12 11-12s11 5 11 12v8c0 6-5 10-11 10s-11-4-11-10zM170 266c0-7 5-12 11-12s11 5 11 12v8c0 6-5 10-11 10s-11-4-11-10z" fill="#B45309"/>
</g>''',
    ears='''<g id="ear-left-group"><path d="M124 96c-16-6-28-18-30-34 16 2 30 8 40 18z" fill="url(#fur)"/><path d="M120 90c-8-4-14-10-16-18 8 2 16 6 22 12z" fill="#FDE68A"/></g>
<g id="ear-right-group"><path d="M196 96c16-6 28-18 30-34-16 2-30 8-40 18z" fill="url(#fur)"/><path d="M200 90c8-4 14-10 16-18-8 2-16 6-22 12z" fill="#FDE68A"/></g>''',
    headmain='''<path d="M160 66c32 0 56 24 56 52 0 32-24 56-56 56s-56-24-56-56c0-28 24-52 56-52z" fill="url(#fur)"/>
<path d="M160 128c17 0 31 8 37 22-6 16-20 26-37 26s-31-10-37-26c6-14 20-22 37-22z" fill="url(#belly)"/>
<path d="M160 142c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z" fill="#3A2A25"/>
<path d="M132 104l-4 24M188 104l4 24" stroke="#7C2D12" stroke-width="3" stroke-linecap="round" opacity="0.9"/>
<circle cx="118" cy="116" r="3" fill="#B45309"/><circle cx="202" cy="98" r="3" fill="#B45309"/><circle cx="206" cy="126" r="2.5" fill="#B45309"/>
''',
    eyecfg=dict(cx1=138, cx2=182, cy=116, rx=8, ry=10, color="#C2410C", iris=None, style="almond"),
    mouthxy=(160, 160),
    appendages={"tail-group": '<path d="M204 240c30 0 48 20 44 42-3 16-16 24-28 18l-18-48z" fill="url(#fur)"/><path d="M228 264h20M230 276h18M226 252h16" stroke="#B45309" stroke-width="5" stroke-linecap="round"/><circle cx="246" cy="298" r="6" fill="#7C2D12"/>'},
    accessory='<g id="accessory-group"><path d="M122 184c10 10 23 14 38 14s28-4 38-14l-5 16c-8 8-20 12-33 12s-25-4-33-12z" fill="url(#accent)"/><path d="M160 202l5 10 11 5-11 5-5 11-5-11-11-5 11-5z" fill="#FDE68A"/></g>',
    stage2='<g id="evolution-stage2"><path d="M108 92l-20-10 8 20zM212 92l20-10-8 20z" fill="#FDE68A"/><path d="M150 56l6 12 12 6-12 6-6 12-6-12-12-6 12-6z" fill="#EF4444"/></g>',
    stage3='<g id="evolution-stage3"><path d="M98 148c-12-16-14-34-6-50M222 148c12-16 14-34 6-50" stroke="#FDE68A" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.8"/><circle cx="160" cy="160" r="120" fill="none" stroke="#FEF08A" stroke-width="3" stroke-dasharray="4 14" opacity="0.5"/></g>',
    mythical='<g id="evolution-mythical"><path d="M118 64l-12-38 30 18zM202 64l12-38-30 18z" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/><circle cx="160" cy="32" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M160 20l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="#FDE68A"/></g>',
)

# ---------------------------------------------------------------- Parrot
p = dict(fur="#34D399", fur2="#059669", belly="#FEF08A", belly2="#FDE047", accent="#3B82F6", accent2="#1D4ED8")
SPECS["parrot"] = dict(
    palette=p,
    body='''<g id="body-group">
<path d="M118 166c0-32 18-52 42-52s42 20 42 52v62c0 28-18 48-42 48s-42-20-42-48z" fill="url(#fur)"/>
<path d="M140 180c0-22 9-36 20-36s20 14 20 36v44c0 20-9 32-20 32s-20-12-20-32z" fill="url(#belly)"/>
<path d="M130 270c0-6 4-10 9-10s9 4 9 10v6c0 6-4 10-9 10s-9-4-9-10zM172 270c0-6 4-10 9-10s9 4 9 10v6c0 6-4 10-9 10s-9-4-9-10z" fill="#F59E0B"/>
</g>''',
    ears='',
    headmain='''<path d="M160 58c34 0 58 24 58 56 0 34-24 58-58 58s-58-24-58-58c0-32 24-56 58-56z" fill="url(#fur)"/>
<path d="M160 120c18 0 32 8 38 22-6 16-20 26-38 26s-32-10-38-26c6-14 20-22 38-22z" fill="#FEF08A" opacity="0.65"/>
<path d="M148 52c-6-18-2-32 8-40 4 12 10 20 20 24M172 52c6-18 2-32-8-40-4 12-10 20-20 24" fill="#F87171"/>
<path d="M130 96c-10-8-20-10-30-6 6 10 16 16 28 18z" fill="#3B82F6" opacity="0.8"/>
<path d="M190 96c10-8 20-10 30-6-6 10-16 16-28 18z" fill="#3B82F6" opacity="0.8"/>
''',
    expression_extra='''<g id="beak-closed"><path d="M160 132c14 0 24 8 24 18 0 12-10 20-24 26-14-6-24-14-24-26 0-10 10-18 24-18z" fill="#F59E0B"/><path d="M160 142c6 0 10 4 10 9 0 6-4 10-10 12-6-2-10-6-10-12 0-5 4-9 10-9z" fill="#D97706"/></g>
<g id="beak-open" display="none"><path d="M160 132c14 0 24 8 24 18 0 6-3 11-8 15l-16-12-16 12c-5-4-8-9-8-15 0-10 10-18 24-18z" fill="#F59E0B"/><path d="M160 160c6 0 10 4 10 8 0 6-4 10-10 12-6-2-10-6-10-12 0-4 4-8 10-8z" fill="#D97706"/></g>''',
    eyecfg=dict(cx1=136, cx2=184, cy=114, rx=7, ry=8, color="#0F172A", iris="#FFFFFF", style="round"),
    mouthxy=(160, 178),
    appendages={
        "wing-left-group": '<path d="M118 170c-30 10-46 36-42 66 3 22 18 36 36 34l20-64z" fill="#F87171"/><path d="M112 190c-14 10-20 26-18 42 2 12 8 20 16 20l10-46z" fill="#FBBF24"/>',
        "wing-right-group": '<path d="M202 170c30 10 46 36 42 66-3 22-18 36-36 34l-20-64z" fill="#F87171"/><path d="M208 190c14 10 20 26 18 42-2 12-8 20-16 20l-10-46z" fill="#FBBF24"/>',
        "tail-group": '<path d="M136 276l-18 30 20-4 22 16 22-16 20 4-18-30z" fill="#3B82F6"/><path d="M146 278l-8 18 10-2 12 10 12-10 10 2-8-18z" fill="#F87171"/>',
    },
    accessory='<g id="accessory-group"><path d="M160 62c0-18 8-30 22-36" stroke="#FDE68A" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="160" cy="214" r="10" fill="#FDE68A"/><path d="M160 208l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#3B82F6"/></g>',
    stage2='<g id="evolution-stage2"><path d="M118 54c-14-16-20-34-14-50 12 12 24 18 38 18M202 54c14-16 20-34 14-50-12 12-24 18-38 18" fill="#FDE68A" stroke="#F59E0B" stroke-width="3"/></g>',
    stage3='<g id="evolution-stage3"><circle cx="160" cy="160" r="120" fill="none" stroke="#93C5FD" stroke-width="3" stroke-dasharray="4 12" opacity="0.55"/><path d="M54 116l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/><path d="M266 116l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#FDE68A"/></g>',
    mythical='<g id="evolution-mythical"><path d="M112 58c-20-14-30-32-26-50 16 10 30 14 46 12M208 58c20-14 30-32 26-50-16 10-30 14-46 12" fill="#A5F3FC" stroke="#22D3EE" stroke-width="3"/><circle cx="160" cy="28" r="12" fill="none" stroke="#FDE68A" stroke-width="3"/><path d="M160 12l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FDE68A"/></g>',
)

ALT_FORMS = {
    "raven": ("shadow", "Umbraven"),
    "owl": ("lunar", "Moon Oracle"),
    "bear": ("iron", "Ironclad"),
    "wolf": ("moon", "Moonhowl"),
    "deer": ("bloom", "Bloomhart"),
    "labrador": ("sun", "Sunpaw"),
    "dolphin": ("coral", "Coralwave"),
    "beaver": ("oak", "Oakshield"),
    "elephant": ("lotus", "Lotusguard"),
    "lion": ("solar", "Solar Mane"),
    "golden-retriever": ("heart", "Heartgold"),
    "cat": ("neon", "Nightprowler"),
    "panda": ("mist", "Mistbloom"),
    "cheetah": ("bolt", "Boltstrike"),
    "parrot": ("aurora", "Aurorawing"),
}

# ---------------------------------------------------------------------------
# Form palettes and SVG assembly
# ---------------------------------------------------------------------------

def _clamp(value: int) -> int:
    return max(0, min(255, value))


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{_clamp(channel):02X}" for channel in rgb)


def lighten(value: str, amount: float) -> str:
    r, g, b = _hex_to_rgb(value)
    return _rgb_to_hex((int(r + (255 - r) * amount), int(g + (255 - g) * amount), int(b + (255 - b) * amount)))


def darken(value: str, amount: float) -> str:
    r, g, b = _hex_to_rgb(value)
    return _rgb_to_hex((int(r * (1 - amount)), int(g * (1 - amount)), int(b * (1 - amount))))


SHINY_OVERRIDES = {
    "raven": dict(fur="#6653A8", fur2="#221A3D", belly="#C4B5FD", belly2="#8B7BD8", accent="#34D399", accent2="#059669"),
    "owl": dict(fur="#C7D2FE", fur2="#6366F1", belly="#F8FAFC", belly2="#E0E7FF", accent="#FDE68A", accent2="#F59E0B"),
    "bear": dict(fur="#BFE3F2", fur2="#3B82F6", belly="#F0F9FF", belly2="#BAE6FD", accent="#FDE68A", accent2="#F59E0B"),
    "wolf": dict(fur="#7DD3FC", fur2="#1E3A8A", belly="#ECFEFF", belly2="#A5F3FC", accent="#C4B5FD", accent2="#7C3AED"),
    "deer": dict(fur="#FBCFE8", fur2="#BE185D", belly="#FFF1F2", belly2="#FECDD3", accent="#FDE68A", accent2="#F59E0B"),
    "labrador": dict(fur="#E2E8F0", fur2="#64748B", belly="#FFFFFF", belly2="#F1F5F9", accent="#7DD3FC", accent2="#0EA5E9"),
    "dolphin": dict(fur="#F9A8D4", fur2="#BE185D", belly="#FFF1F2", belly2="#FECDD3", accent="#FDE68A", accent2="#F59E0B"),
    "beaver": dict(fur="#FCD34D", fur2="#B45309", belly="#FFFBEB", belly2="#FDE68A", accent="#34D399", accent2="#059669"),
    "elephant": dict(fur="#F5D0FE", fur2="#A21CAF", belly="#FDF4FF", belly2="#F0ABFC", accent="#FDE68A", accent2="#F59E0B"),
    "lion": dict(fur="#F8FAFC", fur2="#94A3B8", belly="#FFFFFF", belly2="#E2E8F0", accent="#7DD3FC", accent2="#0EA5E9"),
    "golden-retriever": dict(fur="#FEF3C7", fur2="#F59E0B", belly="#FFFFFF", belly2="#FEF9C3", accent="#7DD3FC", accent2="#0EA5E9"),
    "cat": dict(fur="#4C1D95", fur2="#1E1B4B", belly="#C4B5FD", belly2="#8B5CF6", accent="#F9A8D4", accent2="#EC4899"),
    "panda": dict(fur="#FDE68A", fur2="#B45309", belly="#FFFBEB", belly2="#FDE68A", accent="#34D399", accent2="#059669"),
    "cheetah": dict(fur="#1E293B", fur2="#0F172A", belly="#67E8F9", belly2="#22D3EE", accent="#F0ABFC", accent2="#C026D3"),
    "parrot": dict(fur="#A5F3FC", fur2="#0E7490", belly="#FEF08A", belly2="#FDE047", accent="#F0ABFC", accent2="#C026D3"),
}


def shiny_palette(species: str) -> dict[str, str]:
    palette = dict(SPECS[species]["palette"])
    palette.update(SHINY_OVERRIDES[species])
    return palette


def palette_for(species: str, kind: str) -> dict[str, str]:
    base = dict(SPECS[species]["palette"])
    if kind == "base":
        return base
    if kind == "shiny":
        return shiny_palette(species)
    if kind == "stage2":
        return {
            **base,
            "fur": lighten(base["fur"], 0.10),
            "fur2": lighten(base["fur2"], 0.06),
            "belly": lighten(base["belly"], 0.06),
            "accent": lighten(base["accent"], 0.10),
        }
    if kind == "stage3":
        return {
            **base,
            "fur": darken(base["fur"], 0.04),
            "fur2": darken(base["fur2"], 0.12),
            "belly": lighten(base["belly"], 0.10),
            "accent": darken(base["accent"], 0.06),
            "accent2": darken(base["accent2"], 0.12),
        }
    # Alternate mythical evolution: pull the palette toward the character's
    # element accent while keeping the belly light for readability.
    return {
        **base,
        "fur": base["accent"],
        "fur2": base["accent2"],
        "belly": lighten(base["belly"], 0.18),
        "belly2": lighten(base["belly2"], 0.10),
        "accent": "#FDE68A",
        "accent2": "#F59E0B",
    }


def build_head(spec: dict, palette: dict, expression_extra: str = "") -> str:
    eye_cfg = spec["eyecfg"]
    eyes_xml = eyes(**eye_cfg)
    mouth_xml = mouths(*spec["mouthxy"])
    extra = expression_extra or spec.get("expression_extra", "")
    return (
        '<g id="head-group">'
        f'{spec["ears"]}{spec["headmain"]}{eyes_xml}{mouth_xml}{extra}{flourish()}'
        "</g>"
    )


def build_appendages(spec: dict) -> str:
    return "".join(f'<g id="{layer_id}">{content}</g>' for layer_id, content in spec["appendages"].items())


SHINY_OVERLAY = (
    '<g id="shiny-shimmer">'
    '<path d="M86 84l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#FDE68A"/>'
    '<path d="M244 110l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FFFFFF"/>'
    '<path d="M72 228l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FDE68A"/>'
    '<circle cx="252" cy="212" r="4" fill="#FFFFFF"/>'
    "</g>"
)


def build_accessory(spec: dict, overlays: list[str]) -> str:
    import re as _re

    match = _re.match(r'<g id="accessory-group">([\s\S]*)</g>\s*$', spec["accessory"])
    inner = match.group(1) if match else ""
    return f'<g id="accessory-group">{inner}{"".join(overlays)}</g>'


def build_full_svg(species: str, kind: str) -> str:
    spec = SPECS[species]
    palette = palette_for(species, kind)
    alt_id = ALT_FORMS[species][0]
    overlays: list[str] = []
    if kind == "stage2":
        overlays = [spec["stage2"]]
    elif kind == "stage3":
        overlays = [spec["stage2"], spec["stage3"]]
    elif kind == alt_id:
        overlays = [spec["stage2"], spec["stage3"], spec["mythical"]]
    elif kind == "shiny":
        overlays = [SHINY_OVERLAY]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="none">\n'
        f"{defs(palette)}\n"
        f'<g id="{species}-root">\n'
        '<ellipse id="shadow" cx="160" cy="288" rx="74" ry="14" fill="rgba(20,20,19,0.12)"/>\n'
        f"{build_appendages(spec)}\n"
        f'{spec["body"]}\n'
        f'{build_head(spec, palette)}\n'
        f'{build_accessory(spec, overlays)}\n'
        "</g>\n</svg>\n"
    )


def _set_visible(xml: str, group_id: str, visible: bool) -> str:
    import re as _re

    pattern = _re.compile(rf'<([a-zA-Z]+)\b[^>]*\bid="{_re.escape(group_id)}"[^>]*>')

    def replace(match: "_re.Match[str]") -> str:
        tag = _re.sub(r'\sdisplay="[^"]*"', "", match.group(0))
        if visible:
            return tag
        return tag[:-1] + ' display="none">'

    return pattern.sub(replace, xml)


def _only_expression(head: str, species: str, state: str) -> str:
    eye_id = "eyes-closed" if state == "sleeping" else "eyes-thinking" if state in ("thinking", "curious") else "eyes-open"
    if species == "parrot":
        open_states = {"happy", "celebrating", "playing", "petting", "feeding", "speaking", "tapped", "double-tapped", "long-pressed", "jumping"}
        mouth_id = "beak-open" if state in open_states else "beak-closed"
    else:
        mouth_id = {
            "happy": "mouth-happy", "celebrating": "mouth-happy", "playing": "mouth-happy",
            "petting": "mouth-happy", "feeding": "mouth-happy", "tapped": "mouth-happy",
            "double-tapped": "mouth-happy", "long-pressed": "mouth-happy", "jumping": "mouth-happy",
            "sad": "mouth-sad", "concerned": "mouth-sad", "angry": "mouth-angry",
            "thinking": "mouth-thinking", "curious": "mouth-curious", "sleeping": "mouth-sleep",
            "speaking": "mouth-speaking",
        }.get(state, "mouth-idle")

    all_groups = ["eyes-open", "eyes-closed", "eyes-thinking",
                  "mouth-idle", "mouth-happy", "mouth-sad", "mouth-angry", "mouth-thinking",
                  "mouth-curious", "mouth-speaking", "mouth-sleep", "beak-closed", "beak-open",
                  "expression-blush", "expression-sweat", "expression-sparkle"]
    out = head
    for group_id in all_groups:
        visible = group_id == eye_id or group_id == mouth_id
        if group_id == "expression-blush":
            visible = state in ("happy", "celebrating", "playing", "petting")
        if group_id == "expression-sweat":
            visible = state in ("sad", "concerned")
        if group_id == "expression-sparkle":
            visible = state == "celebrating"
        out = _set_visible(out, group_id, visible)
    return out


def _suffix_ids(xml: str, suffix: str) -> str:
    import re as _re

    return _re.sub(r'id="([^"]+)"', lambda match: f'id="{match.group(1)}{suffix}"', xml)


def build_expressions_svg(species: str) -> str:
    spec = SPECS[species]
    palette = palette_for(species, "base")
    states = ["idle", "happy", "thinking", "sad", "angry", "sleeping"]
    cells = []
    for index, state in enumerate(states):
        col = index % 3
        row = index // 3
        x = col * 320
        y = row * 340 + 20
        head = _only_expression(build_head(spec, palette), species, state)
        head = _suffix_ids(head, f"-{state}")
        cells.append(
            f'<g transform="translate({x},{y})">{head}</g>'
            f'<text x="{x + 160}" y="{y + 316}" fill="#D8D2C8" font-size="18" font-family="sans-serif" text-anchor="middle">{state}</text>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 680" fill="none">\n'
        '<rect width="960" height="680" rx="24" fill="#15171C"/>\n'
        f"{defs(palette)}\n"
        '<g id="expression-sheet">'
        + "".join(cells)
        + "</g>\n</svg>\n"
    )


def build_animations_svg(species: str) -> str:
    spec = SPECS[species]
    palette = palette_for(species, "base")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="none">\n'
        f"{defs(palette)}\n"
        '<g id="animation-layers">\n'
        '<ellipse id="shadow" cx="160" cy="288" rx="74" ry="14" fill="rgba(20,20,19,0.10)"/>\n'
        f'<g opacity="0.22">{spec["body"]}{build_head(spec, palette)}</g>\n'
        f"{build_appendages(spec)}\n"
        "</g>\n</svg>\n"
    )


def asset_ts(species: str) -> str:
    spec = SPECS[species]
    alt_id = ALT_FORMS[species][0]
    const_name = species.replace("-", "_").upper()
    prefix = "../../../../../orbit-buddy/characters/" + species
    imports = [
        ("baseSvg", "base.svg"),
        ("stage2Svg", "evolution-stage2.svg"),
        ("stage3Svg", "evolution-stage3.svg"),
        (f"{alt_id}Svg", f"evolution-{alt_id}.svg"),
        ("shinySvg", "shiny-form.svg"),
        ("expressionsSvg", "expressions.svg"),
        ("animationsSvg", "animations.svg"),
    ]
    lines = [
        "// AUTO-GENERATED by scripts/generate-buddy-assets.py. Do not edit by hand.",
        f"// Original ORBIT artwork for {spec.get('display_name', species)}.",
    ]
    for local, file_name in imports:
        lines.append(f"import {local} from '{prefix}/{file_name}';")
    lines.extend([
        "",
        f"export const {const_name}_FORM_KEYS = [",
        f"  '{species}_base',",
        f"  '{species}_stage2',",
        f"  '{species}_stage3',",
        f"  '{species}_{alt_id}',",
        f"  '{species}_base_shiny',",
        "] as const;",
        "",
        f"export const {const_name}_SVG_SOURCES: Record<string, number> = {{",
        f"  '{species}_base': baseSvg as unknown as number,",
        f"  '{species}_stage2': stage2Svg as unknown as number,",
        f"  '{species}_stage3': stage3Svg as unknown as number,",
        f"  '{species}_{alt_id}': {alt_id}Svg as unknown as number,",
        f"  '{species}_base_shiny': shinySvg as unknown as number,",
        "  expressions: expressionsSvg as unknown as number,",
        "  animations: animationsSvg as unknown as number,",
        "};",
        "",
    ])
    return "\n".join(lines)


def write_assets() -> None:
    for species in SPECS:
        directory = ROOT / species
        directory.mkdir(parents=True, exist_ok=True)
        alt_id = ALT_FORMS[species][0]
        (directory / "base.svg").write_text(build_full_svg(species, "base"), encoding="utf-8")
        (directory / "evolution-stage2.svg").write_text(build_full_svg(species, "stage2"), encoding="utf-8")
        (directory / "evolution-stage3.svg").write_text(build_full_svg(species, "stage3"), encoding="utf-8")
        (directory / f"evolution-{alt_id}.svg").write_text(build_full_svg(species, alt_id), encoding="utf-8")
        (directory / "shiny-form.svg").write_text(build_full_svg(species, "shiny"), encoding="utf-8")
        (directory / "expressions.svg").write_text(build_expressions_svg(species), encoding="utf-8")
        (directory / "animations.svg").write_text(build_animations_svg(species), encoding="utf-8")

        ts_path = Path(__file__).resolve().parent.parent / "src" / "lib" / "buddy" / "characters" / "assets" / f"{species}.ts"
        ts_path.parent.mkdir(parents=True, exist_ok=True)
        ts_path.write_text(asset_ts(species), encoding="utf-8")

    print(f"Generated {len(SPECS)} character packs in {ROOT}")


if __name__ == "__main__":
    write_assets()
