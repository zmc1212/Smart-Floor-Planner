# Smart Floor Planner Mini Program Design Spec

## 1. Purpose

This document defines the visual design rules for the Smart Floor Planner mini program.
It should be treated as the source of truth for UI generation, page redesign, and component styling.

Primary visual reference:
- `miniprogram/ChatGPT Image 2026年4月28日 16_27_02.png`

Page-specific visual reference:
- Home (`pages/index/index`): `design-references/miniprogram-home-vibrant-green-v5.png`
  at the iPhone 13 Pro `390x844` baseline. The reference controls the home
  composition, spacing, image treatment, and card hierarchy while live data,
  role boundaries, navigation, and empty states remain authoritative.
- Mine (`pages/mine/mine`):
  `design-references/miniprogram-mine-v6.png` at the iPhone 13 Pro `390x844`
  baseline, with production crops sourced from both that screen and
  `design-references/miniprogram-mine-v6-icon.png`. The reference controls the
  scene-led profile header, three-card summary viewport, role-aware workbench,
  compact two-item todo list, and AI design banner.
  The established floating circular Measure action remains the center TabBar
  treatment; do not replace it with the reference's rectangular center action.
  Server-provided actions, role boundaries, loading/error/empty states, and
  ordinary-user floor-plan behavior remain authoritative.
- Leads (`pages/leads-management/leads-management`):
  `design-references/leads-management-v4.png` at the iPhone 13 Pro `390x844`
  baseline. The reference controls the scene-led header, summary card,
  search/action row, six-stage filter rhythm, customer-card anatomy, and
  color-coded floor-plan thumbnail treatment. Thumbnail geometry must come from
  each lead's associated formal wall graph or real external preview URL; static
  sample plans are design references only. Live lead data, role visibility, pagination, navigation,
  loading/error/empty states, and the shared custom tab bar remain authoritative.

When image reference and implementation differ:
- Follow this document first
- Follow `design-tokens.json` second
- Use the image for mood and composition reference

## 2. Brand Direction

### Keywords
- clean
- fresh
- natural
- lightweight
- friendly
- professional
- home-focused

### Emotional Tone
- Make the product feel approachable instead of technical
- Make home measurement and design feel easy and pleasant
- Prefer calm confidence over flashy novelty

### Avoid
- dark enterprise dashboards
- purple/blue tech styling
- heavy borders
- noisy gradients
- dense information walls
- overly sharp corners

## 3. Visual Principles

### Overall Look
- Use bright backgrounds with soft contrast
- Keep large white cards and generous spacing
- Emphasize green as the core brand color
- Use light botanical or home-related decorative visuals sparingly

### Composition
- Prefer card-based layouts
- Keep clear vertical rhythm
- Important actions should be obvious and low-friction
- Empty states should feel warm and guided, not blank

### Density
- Medium-low density
- Prioritize clarity over showing too much at once

### Viewport And One-Screen Baseline
- Use iPhone 13 Pro at `390x844` as the primary visual QA viewport
- Standard fixed-content result and action pages should show the page heading, primary content, key actions, and final CTA in one screen, including the navigation bar and bottom safe area
- Preserve hierarchy by reducing oversized media height and redundant whitespace before reducing readable type or touch targets
- Lists, dynamic content, accessibility text, and smaller viewports may scroll; critical actions should not require scrolling solely because of avoidable spacing
- On Mine, narrow real-device viewports at or below `360px` must preserve the
  role workbench's fixed four-column rhythm; tighten card gaps and horizontal
  padding before considering a column-count change.

### Design Research Before Visual Work
- Before creating a new high-fidelity page direction or AI-generated visual reference, research current, relevant mobile UI examples online. Use Huaban (花瓣网) as the preferred first source when it is available, then search the product category, the core interaction, and the target surface (for example: WeChat Mini Program home pages, renovation project progress, interior-design apps, or field-service tools).
- Use at least three relevant references or patterns to inform hierarchy, card composition, illustration/photo treatment, icon rhythm, and interaction affordances. A supplied reference image is valuable input, but it must not be the only design source.
- Translate research into an original composition that follows this project’s product flows, token system, and accessibility requirements. Never copy another product’s branding, text, icons, screen layout, or assets.
- If Huaban or another named design site cannot be reached, use equivalent public current examples and state that substitution in the design handoff. Do not silently fall back to an old local reference image alone.

## 4. Color System

### Primary
- Primary 100: `#22C55E`
- Primary 80: `#6FD77B`
- Primary 60: `#9BE7A7`
- Primary 40: `#C7F1CC`
- Primary 20: `#EAF8EC`

### Secondary Accent
- Secondary Green: `#4CAF50`
- Mint: `#8FD19E`
- Cyan Mint: `#A8E6CF`
- Warm Yellow: `#FFC857`
- Soft Pink: `#FF8BA7`

### Neutral
- Neutral 900: `#1F2937`
- Neutral 700: `#4B5563`
- Neutral 500: `#6B7280`
- Neutral 300: `#D1D5DB`
- Neutral 100: `#F3F4F6`
- White: `#FFFFFF`

### Usage Rules
- Green is the default color for primary actions, active tabs, positive status, and brand emphasis
- Dark neutral is used for major text
- Mid neutral is used for helper text and metadata
- Light neutral is used for page background blocks, borders, and soft surfaces
- Yellow, pink, and cyan should only be used as supporting accents, not dominant page themes

### Color Composition And Page Rhythm
- The product is **green-led, not green-only**. Green is the brand anchor and should make the primary action, selected state, or one hero scene immediately recognizable; it must not fill every card, icon background, status treatment, and lower-page module.
- On a standard page, use one dominant green moment at most (for example, the home hero or a single primary CTA). Let the remaining content breathe on white or light-neutral surfaces so the hierarchy does not become flat or monotonous.
- Build visual rhythm in lower-page content with a layered composition: neutral/white as the base, mint for soft grouping, and a restrained yellow, pink, or cyan accent for selected feature icons, illustrations, thumbnails, or supportive highlights. Do not repeat the same green fill across adjacent modules.
- Accent colors must have a role rather than being decorative noise. For example: warm yellow can identify a creative/AI shortcut, pink can support a lightweight communication or promotion cue, and cyan/mint can support device, location, or environmental information. Keep all business status meanings aligned with the status token system.
- A colourful icon grid may use different **soft accent backgrounds**, but its icons must remain one coherent line/filled family with consistent stroke weight, size, padding, and corner treatment. Never compensate for weak hierarchy by mixing arbitrary icon styles.
- Ongoing-plan and recent-plan cards should gain character from a real plan thumbnail or restrained home-related illustration, progress, and a compact status chip. Use green only for progress and positive state; do not turn the entire card into another green banner.
- When a rich green scene is used at the top of a home page, use a deliberate overlap into the white content area (for example, an elevated primary-task card) and then transition to calmer, differently accented modules below. The visual goal is a fresh, lively home-service product with depth, not a monochrome green dashboard.

### Forbidden Color Behavior
- Do not replace the primary green with blue or purple
- Do not use saturated red as a major UI theme
- Do not use black backgrounds for standard business pages
- Do not make an entire screen or a run of adjacent cards the same primary-green treatment; this produces a rigid, single-note interface and weakens the primary action.

## 5. Typography

### Font Family
- Chinese: `Source Han Sans`
- Fallback: `PingFang SC`, `Microsoft YaHei`, `sans-serif`

### Type Scale
- Page Hero / Brand Title: `28px`, `700`
- Section Title: `20px`, `500`
- Body Text: `14px`, `400`
- Secondary Text: `12px`, `400`

### Text Rules
- Titles should be concise and stable
- Body text should stay readable and low-noise
- Secondary text should be muted, never high-contrast
- Avoid using more than 3 visible font sizes in a single module
- At the `390x844` Mini Program baseline, primary labels, actions, body copy,
  and business values must use at least `24rpx` (about `12px`)
- Secondary metadata and helper text must use at least `20rpx` (about `10px`);
  smaller text is allowed only for nonessential decorative annotation
- Never visually shrink text below these floors with `transform: scale(...)`
  or by baking required UI copy into an image

## 6. Radius And Shadow

### Radius
- `4px`
- `8px`
- `12px`
- `16px`
- `20px`

### Preferred Usage
- Small controls: `8px`
- Inputs and chips: `12px`
- Cards: `16px`
- Large feature blocks / dialogs: `20px`

### Shadow
- Card Shadow: `0 4px 20px rgba(0,0,0,0.06)`
- Floating Shadow: `0 8px 24px rgba(0,0,0,0.08)`
- Popup Shadow: `0 12px 32px rgba(0,0,0,0.10)`

### Shadow Rules
- Shadows should be soft and diffused
- Avoid hard-edged shadows
- Do not stack multiple strong shadows in one component

### Hairline Rules
- Use separators only where they clarify grouping, and keep them shorter than their containing control when possible
- For a subpixel visual weight, render a `1px` line and apply `transform: scaleX(0.5)` to a vertical line or `transform: scaleY(0.5)` to a horizontal line
- Do not use a heavy full-height border between adjacent text actions

## 7. Icon Style

### Style
- thin to medium line icons
- rounded corners
- light, friendly, modern

### Common Icon Contexts
- home
- search
- add
- notification
- user
- calendar
- filter
- location
- delete

### Rules
- Default icon color should be brand green or muted neutral
- Avoid filled heavy icons unless used for tiny badges or emphasis
- Primary action icons must come from one coherent, locally stored icon set with its source and license recorded in the repository
- Do not use emoji, mixed Unicode symbols, or multi-stroke CSS drawings as product icons
- CSS geometry remains acceptable for simple status dots, chevrons, loading indicators, and separators
- Design icons as refined, recognisable micro-illustrations rather than generic one-stroke placeholders: use a consistent 1.75–2px rounded stroke, intentional inner details (for example dimension ticks on a ruler, door swing on a floor-plan tool, or a small badge on a lead), and a compact two-tone accent only where it improves recognition. Preserve one icon family, fixed visual weight, and generous optical padding; never mix flat glyphs, emojis, and unrelated outline styles in the same screen.
- When a coloured icon tile is used, pair a light semantic surface with a more saturated main stroke and at most one restrained supporting detail. Keep the tile background, icon silhouette, and label distinct enough to scan at a glance; do not paint every icon green.

### Raster Micro-Icon Budget
- Small UI icons (navigation, toolbar, and inline actions) should use a transparent raster asset at no more than 2× its displayed logical size and must be **10KB or smaller** after export.
- The filename extension must match the actual encoded format; do not store JPEG data under a `.png` name.
- Keep the editable vector source and its license under `docs/icon-sources/`; record any necessary size-budget exception beside that source.

## 8. Component Rules

### Top Bar
- White or very light background
- Left brand icon + product name
- Right side for search, notifications, user avatar, or utility actions
- Use subtle shadow instead of heavy border

### Search Bar
- Rounded large input
- Light background
- Search icon on the left
- Optional green action button on the right

### Tabs
- Horizontal tabs
- Active tab uses green text and green underline
- Inactive tabs use neutral text
- Keep tab styling lightweight

### Cards
- White surface
- Radius `16px`
- Soft shadow
- Content should breathe
- Important action button should usually align to bottom-right or right side

### Buttons
- Primary button: green fill, white text
- Secondary button: white or very light fill, green border, green text
- Text button: green text, low decoration
- Icon button: circular or rounded-square, white background, soft shadow

### Status Chips
- Measuring: green family
- Designing: blue family
- Converted: orange family
- Cancelled: gray family

Status chips should be:
- soft background
- medium-weight label
- compact and calm

## 9. Page Patterns

### List Pages
- Use top summary + search/filter + tab strip + card list
- Each card should show the main info first, metadata second, action third

### Empty States
- Use soft illustration
- Include one clear CTA
- Tone should be encouraging, not alarming

### Dashboard / Overview
- Prefer large cards and grouped modules
- Avoid spreadsheet-style information blocks

### Formal Surveying Editor State Coverage
- A formal measurement design review must cover the real editor states instead of approving a single static canvas: `idle` / `cursorPlaced` / `wallSnapPending`, `wallPreview` / `awaitingLength`, `wallCommitted` / `closing` / `mergeClosing` / `spaceClosed`, `wallSelected` / `remeasureAwaitingInput`, and the selected-opening state.
- The design set must also cover every full-screen or bottom-sheet editing branch: manual length and wall-thickness input, BLE-assisted measurement, phone-sensor and Pythagorean angle measurement, and the component editor's `spec`, `flip`, and `library` panels.
- Preserve spatial continuity between states: the plan canvas, selected geometry, dimension label, and active anchor must remain visually identifiable when a sheet or contextual toolbar opens. Use overlay elevation and local colour emphasis rather than replacing the canvas with an unrelated screen.
- State feedback is part of the design: show saved/draft status, connected or unavailable measurement-device state, disabled undo/redo, destructive reset confirmation, successful room closure, and recoverable validation feedback with concise, non-blocking treatments.
- Do not use WeChat DevTools screenshots as visual evidence for `pages/surveying-editor/surveying-editor`. In that environment the native Canvas can cover `view` or `cover-view` overlays, so its screenshots do not represent the real layout. Validate this page through state-specific WXML/WXSS layering, state-branch tests, and the approved design references instead.
- The v8 `cursorPlaced` reference state uses a low-contrast single-step grid, neutral-grey wall solids, a pale closed-space fill, and a green snapped anchor linked to a short green guide cross. It must not render the legacy blue full-canvas axes or orange square cursor; these changes are scoped to that state and preserve the measured floor-plan geometry.

### Formal Surveying Editor Fixed Chrome
- Every formal-surveying reference and implementation state must reuse one fixed shell. Do not redesign the surrounding application chrome per state.
- The canvas top bar is invariant: white surface, the same safe-area height, left 40px back target, title format `云栖花园 · 正式量房`, one compact green-dot saved indicator, then the text actions `保存` and `完成` aligned at the same right positions. A component-editor state may replace only the title with `构件编辑`; its height, icon placement, saved indicator, and action positions remain unchanged.
- The right-side tool rail has a stable width, alignment, icon size, and 2px rounded-outline family in every canvas state. A context panel may appear beside it, but must not replace it with a different navigation pattern.
- The bottom shell is invariant: left history controls, a centered context action, and a right primary action remain on the same baseline. `重置光标` is one named cursor control with one icon, label, shape, and placement; it may be disabled or replaced only when the state makes cursor placement impossible, never visually redesigned.
- A number pad, closure prompt, angle sheet, or component panel rises above this shell with the same 20px top radius, handle, shadow, horizontal inset, typography, and CTA alignment. It changes content only; it does not invent a new bottom navigation, toolbar, or top bar.
- Across a state set, keep page background, 8px spacing rhythm, canvas grid, wall/dimension rendering, corner radii, type scale, status-dot treatment, and green/amber/coral semantics identical. State difference must be readable from selected geometry and local overlays, not from a new visual identity.

### Formal Surveying Angle Sheet

Review the phone-motion and Pythagorean angle states through four fixed lenses
before implementation or visual approval:

- **Page structure:** preserve the formal-surveying canvas and fixed chrome, then
  raise one shared angle sheet with the same title, description, tabs, handle,
  and action baseline in both modes. While the sheet is open, suspend and hide
  the native canvas history, cursor-drop, and drag-lens controls so they cannot
  pierce the sheet's visual or touch layer; restore them in place on close.
- **Components:** phone mode uses a calibrated dial, live angle, horizontal-phone
  cue, baseline action, manual fallback, and confirm action. Pythagorean mode uses
  three numbered A/B/D BLE rows, per-row measuring/completed feedback, one result
  band, retry, cancel, and confirm.
- **Colour:** green is reserved for the selected tab, stable/confirmed angle,
  completed readings, result, and primary confirmation. Amber identifies live
  measurement and baseline/device cues. White and neutral grey remain the
  dominant surfaces; red appears only for invalid triangle feedback.
- **Spacing:** use an 8px rhythm, 16px sheet gutters, 44px minimum actions, equal
  tab widths, consistent A/B/D row heights, and one shared bottom CTA baseline.

The three non-negotiable visual checks are: the canvas remains recognisable
behind the sheet; the two methods read as variants of one task rather than two
different pages; and green/amber semantics communicate state without turning
the whole panel green.

## 10. Illustration Style

### Style Keywords
- fresh green
- soft 3D
- home scene
- plants
- miniature interior
- light and airy

### Allowed Illustration Themes
- homes
- interior spaces
- measurement tools
- clipboard and workflow
- plants and soft environmental shapes

### Avoid
- cyberpunk
- abstract SaaS blobs as the main theme
- dark isometric server-room visuals

## 11. Motion Guidance

### Motion Style
- subtle
- smooth
- short
- functional

### Recommended Motion
- card fade/slide on load
- tab transition
- button press feedback
- modal rise animation

### Avoid
- elastic motion
- flashy scale effects
- long transitions

## 12. Implementation Rules For AI

When generating UI for this mini program:
- Use the green design system from this file
- Treat green as the brand anchor rather than a blanket fill; follow the Color Composition And Page Rhythm rules to introduce intentional white, neutral, mint, yellow, pink, and cyan variation
- Keep interfaces bright and spacious
- Prefer white cards on soft light backgrounds
- Reuse the radius and shadow system consistently
- Keep typography restrained and readable
- Use accent colors only as support
- Preserve the calm home-design visual language

Do not:
- switch to unrelated color themes
- invent a dark mode unless explicitly asked
- use default blue primary buttons
- introduce sharp-cornered enterprise table styling as the dominant pattern

## 13. Global Variables

The mini program global style variables are defined in:
- `miniprogram/app.wxss`

These variables are the preferred implementation layer for all new pages and components.

### Core Color Variables
- `--brand-primary`
- `--brand-primary-80`
- `--brand-primary-60`
- `--brand-primary-40`
- `--brand-primary-20`
- `--accent-secondary-green`
- `--accent-mint`
- `--accent-cyan-mint`
- `--accent-yellow`
- `--accent-pink`
- `--neutral-900`
- `--neutral-700`
- `--neutral-500`
- `--neutral-300`
- `--neutral-100`
- `--neutral-0`

### Text Variables
- `--text-primary`
- `--text-secondary`
- `--text-muted`
- `--text-inverse`
- `--text-brand`

### Surface Variables
- `--bg-page`
- `--bg-surface`
- `--bg-surface-soft`
- `--bg-brand-soft`

### Border Variables
- `--border-soft`
- `--border-brand`
- `--border-brand-soft`

### Status Variables
- `--status-measuring-bg`
- `--status-measuring-text`
- `--status-designing-bg`
- `--status-designing-text`
- `--status-converted-bg`
- `--status-converted-text`
- `--status-cancelled-bg`
- `--status-cancelled-text`

### Radius Variables
- `--radius-xs`
- `--radius-sm`
- `--radius-md`
- `--radius-lg`
- `--radius-xl`
- `--radius-full`

### Shadow Variables
- `--shadow-card`
- `--shadow-float`
- `--shadow-popup`
- `--shadow-border-soft`

### Typography Variables
- `--font-size-hero`
- `--font-size-title`
- `--font-size-body`
- `--font-size-caption`
- `--font-weight-bold`
- `--font-weight-medium`
- `--font-weight-regular`

## 14. Variable Usage Rules

For all future UI implementation:
- Prefer `var(--...)` variables from `app.wxss`
- Do not hardcode colors if a matching global variable already exists
- Do not hardcode radius values if a matching radius variable already exists
- Do not hardcode shadows if a matching shadow variable already exists
- Only introduce a new variable when an existing one cannot express the requirement

### Examples
- Primary button background: `var(--brand-primary)`
- Primary button text: `var(--text-inverse)`
- Page background: `var(--bg-page)`
- Main card background: `var(--bg-surface)`
- Secondary text: `var(--text-secondary)`
- Card radius: `var(--radius-lg)`
- Card shadow: `var(--shadow-card)`

### Status Usage
- Measuring chip: `var(--status-measuring-bg)` + `var(--status-measuring-text)`
- Designing chip: `var(--status-designing-bg)` + `var(--status-designing-text)`
- Converted chip: `var(--status-converted-bg)` + `var(--status-converted-text)`
- Cancelled chip: `var(--status-cancelled-bg)` + `var(--status-cancelled-text)`

## 15. Instruction Template For Future AI Tasks

Use this instruction template in future implementation tasks:

`Please strictly follow miniprogram/DESIGN.md, miniprogram/design-tokens.json, and the global variables defined in miniprogram/app.wxss. Reuse existing var(--...) tokens instead of hardcoded colors, radius values, and shadows.`

## 16. File Usage Guidance

For AI-assisted implementation, always provide:
- `miniprogram/DESIGN.md`
- `miniprogram/design-tokens.json`
- `miniprogram/app.wxss`

Recommended instruction template:

`Please strictly follow miniprogram/DESIGN.md, miniprogram/design-tokens.json, and miniprogram/app.wxss. Use the image file as visual reference only. Prefer existing var(--...) globals over hardcoded values. Do not change the brand color system, radius system, typography hierarchy, button style, or illustration direction unless explicitly requested.`
