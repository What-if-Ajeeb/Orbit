# ORBIT Design System

ORBIT's mobile UI uses a small set of shared tokens and components so every screen
feels like part of the same Android app. The system is intentionally calm: warm
neutral surfaces, one coral brand accent, clear typography, compact cards and
restrained motion. There is no blur or decorative glass effect.

## Tokens

All tokens live in `src/theme.ts`.

- **Color**: `darkColors` / `lightColors` provide `background`, `surface`,
  `surfaceAlt`, `border`, text, accent, success, warning and danger values.
  `palette` holds the raw light/dark values.
- **Typography**: `typography` defines `display`, `title`, `section`, `body`,
  `bodySmall`, `caption`, `overline`, `button` and `code` scales. Headings use
  the ORBIT serif (`fonts.serif`); everything else uses the system sans font.
- **Spacing and layout**: `spacing` (`xs`…`xl`), `layout.gutter`,
  `layout.contentMaxWidth`, `layout.touchTarget` and `layout.iconButton`.
- **Radius**: `radius.sm/md/lg/xl/pill`.
- **Elevation**: `elevation.none/card/raised`. Borders are the primary
  separation cue; elevation is subtle.
- **Motion**: `motion.fast/normal/slow` for short, functional transitions.

Use `useAppTheme()` for the active palette and `useStyles(makeStyles)` for
memoized, theme-aware styles. Import the non-color tokens directly from
`@/theme`.

## Shared components

| Component | Use |
| --- | --- |
| `ScreenHeader` | Standard screen title with optional `eyebrow`, `subtitle`, `left` and `right` slots. |
| `Button` | Primary/secondary/danger/ghost actions with consistent loading, disabled and pressed states. |
| `GlassView` | Flat rounded surface (`card`, `panel`, `pill`, `bar`) and optional press handling. |
| `TextField` | Labeled input with focus, hint and password-visibility states. |
| `StatusPill` | Compact truthful status label (`connected`, `unreachable`, `pending`, etc.). |
| `SettingsSection` | Section heading, description and body spacing. |
| `SettingsNavRow` | Compact navigation row for settings-style screens. |
| `EmptyState` | Consistent empty state with optional single action. |
| `FormError` | Accessible inline error message. |
| `Skeleton` | Loading placeholder. |

## Rules

- Keep content aligned to `layout.gutter` and constrained to
  `layout.contentMaxWidth` on wide screens.
- Use `StatusPill` for state; never infer live connection health from saved
  configuration alone.
- Prefer one card per logical section. Avoid cards nested inside cards.
- Every interactive row must meet `layout.touchTarget` and expose an
  accessibility label/state.
- Use short transitions from `motion`; avoid decorative animation.
- Keep Sandbox as invisible backend infrastructure: no Sandbox screen, drawer
  item, settings entry or branding.
