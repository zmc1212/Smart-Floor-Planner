# Smart Floor Planner Mini Program Design Spec

## 1. Purpose

This document defines the visual design rules for the Smart Floor Planner mini program.
It should be treated as the source of truth for UI generation, page redesign, and component styling.

Brand-IP source of truth:
- `docs/design/jiakelai-brand-ip-guidelines.md` defines the confirmed
  `F1 character body + F3 spatial transformation` direction, Xiao K's product
  roles, the approved C-style business-metaphor approach, and the rules for
  integrating the mascot into real UI.
- Read that document before designing or redesigning any Mini Program surface.
  This file remains authoritative for tokens, accessibility, layout floors,
  component behavior, and the broader Mini Program visual system.

Primary visual reference:
- `miniprogram/ChatGPT Image 2026年4月28日 16_27_02.png`

Page-specific visual reference:
- Home (`pages/index/index`): `design-references/all-pages-ip-v1/01-home.png`
  at the iPhone 13 Pro `390x844` baseline. The reference controls the F1/F3
  spatial-guide hero, overlapping formal-surveying card, three quick-service
  cards, and project-progress hierarchy. Production uses the derived local
  scene asset `images/home-ip-v1/hero-scene-wechat-safe.jpg`, which reserves
  the native WeChat capsule safe area and keeps Xiao K fully visible; live
  data, role boundaries, navigation, and empty states remain authoritative.
- Login (`pages/login/login`):
  `design-references/all-pages-ip-v1/06-login.png` at the iPhone 13 Pro
  `390x844` baseline. The reference controls the Xiao K opening-the-door hero,
  approved brand lockup, overlapping two-mode login panel, three-part capability
  summary, and compact return action. Production uses the derived local scene
  asset `images/login-v1/hero-scene.jpg`; the approved lockup remains in the
  derivative while all authentication text and controls stay live. WeChat
  quick login, staff password login, loading/error behavior,
  notification opt-in, and route return semantics remain authoritative.
- Mine (`pages/mine/mine`):
  `design-references/mine/miniprogram-mine-v6.png` at the iPhone 13 Pro `390x844`
  baseline, with production crops sourced from both that screen and
  `design-references/mine/miniprogram-mine-v6-icon.png`. The reference controls the
  scene-led profile header, three-card summary viewport, role-aware workbench,
  compact two-item todo list, and AI design banner.
  The established floating circular Measure action remains the center TabBar
  treatment; do not replace it with the reference's rectangular center action.
  Server-provided actions, role boundaries, loading/error/empty states, and
  ordinary-user floor-plan behavior remain authoritative.
- Leads (`pages/leads-management/leads-management`):
  `design-references/all-pages-ip-v1/02-leads-management.png` at the iPhone 13 Pro
  `390x844` baseline. The reference controls the Xiao K client-concierge scene,
  asymmetric green dossier summary, search/filter/create action order, six
  dossier-index stage tabs, stacked customer-record cards, and right-aligned
  status-coloured floor-plan thumbnail treatment. Production uses the derived
  local transparent scene asset `images/leads-ip-v1/client-concierge-scene.png`; customer
  counts and controls remain live UI rather than image text. Thumbnail geometry
  must come from each lead's associated formal wall graph or real external preview
  URL; static sample plans are design references only. Live lead data, role
  visibility, pagination, navigation, loading/error/empty states, and the shared
  custom tab bar remain authoritative. Its circular Measure entry uses the
  generated transparent Xiao K asset `images/mine-icons/tab-measure-k.png`
  with a separate live label. The approved C-style client-dossier
  metaphor and Xiao K client-concierge role remain the durable Leads brand model.
- Commission Records (`pages/commission-records/commission-records`):
  `design-references/all-pages-ip-v1/12-commission-records.png` at the iPhone 13
  Pro `390x844` baseline. The reference controls the custom navigation, the
  single Xiao K income-assistant scene, the green pending-settlement summary,
  the four status filters, grouped record rows, and the settlement explanation.
  Production uses the derived local scene asset
  `images/commission-records-ip-v1/hero-scene.jpg`; live tenant-scoped records,
  real commission types, amounts, dates, statuses, and read-only settlement
  authority remain authoritative.
- Promotion records (`pages/promotion-records/promotion-records`):
  `design-references/all-pages-ip-v1/09-promotion-records.png` at the iPhone 13 Pro
  `390x844` baseline. The reference controls the enterprise-filing Xiao K hero,
  rounded search surface, five role-view tabs, and compact record-card anatomy.
  It is a tertiary workflow page and must not render a page-local TabBar or dock.
  Production uses the local derived scene asset
  `images/promotion-records/hero-scene.jpg`; enterprise data, role-scoped views,
  public-pool claim approval, loading/search/empty states, and all navigation
  remain driven by current routes and APIs.
- Promotion record detail (`pages/promotion-record-detail/promotion-record-detail`):
  `design-references/all-pages-ip-v1/10-promotion-record-detail.png` at the
  iPhone 13 Pro `390x844` baseline. The reference controls the compact report
  overview, four-stage service rail, follow-up editor, vertical activity trail,
  and administrator assignment panel. Xiao K acts as the report-stamp clerk;
  production uses the project-local derivative
  `images/promotion-detail/hero-scene.png`, while the company, masked phone,
  stage labels, dates, activity records, assignees, role visibility, and all
  actions remain live and server-authoritative.
- Promotion record create (`pages/promotion-record-detail/promotion-record-detail?mode=create`):
  `design-references/all-pages-ip-v1/11-promotion-record-create.png` at the
  iPhone 13 Pro `390x844` baseline. The reference controls the native title,
  Xiao K enterprise-intake hero, enterprise/contact work-order sections,
  location action, helper copy, and final submission geometry. Production uses
  `images/promotion-create/hero-scene.jpg` plus the licensed local Lucide raster
  set; all labels, values, validation, pickers, location feedback, loading state,
  and submission remain native, live UI.
- AI Design (`pages/ai-design/ai-design`):
  `design-references/ai-design/ai-design-immersive-c-floor-map-v1.png` is the primary
  `390x844` reference, with
  `design-references/ai-design/ai-design-immersive-b-workflow-v1.png` governing the
  workflow-stage rail and next-action hierarchy. When no formal floor plan is
  selected, `design-references/ai-design/ai-design-immersive-a-space-tour-v1.png`
  governs the scene-led discovery state. Its waypoints are navigation states,
  not static task buttons or numbered workflow steps: use capability icons and
  plain action labels without ordinal numbers, and let the separate scheme rail
  be the only ordered progression. Selecting a waypoint must visibly refocus
  the scene and update the confirmed next action. The plan or scene remains the dominant
  first-viewport surface instead of collapsing into a banner. This page uses
  `navigationStyle: custom`; never reintroduce the centered default WeChat
  title bar. The title, credit balance, capsule safe area, and spatial visual
  form one continuous header composition. Production must render the selected
  plan from its formal version-4 wall graph read model. A displayed 3D cover
  must be the current generated result controlled by that real wall graph;
  the design-reference image must never become a static or invented customer
  floor plan. Live role-scoped sources, workflow selection, provider
  availability, credits, recent-task state, and the shared custom tab bar remain
  authoritative.

When image reference and implementation differ:
- Follow this document first
- Follow `design-tokens.json` second
- Use the image for mood and composition reference

### TabBar Scope

- The shared custom TabBar is rendered only by the four top-level routes declared
  in `app.json.tabBar`: `pages/index/index`,
  `pages/leads-management/leads-management`, `pages/ai-design/ai-design`, and
  `pages/mine/mine`. Its raised Measure control is part of that shared TabBar,
  not a fifth page route.
- Every detail, create, workflow, search-result, editor, login, and other
  secondary or tertiary page must not recreate, mount, or visually imitate a
  TabBar. These routes stay in the native page stack and preserve their existing
  page-level actions and navigation behavior.

## 2. Brand Direction

For all durable brand-character and brand-mechanism decisions, follow
`docs/design/jiakelai-brand-ip-guidelines.md`.

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

### High-Fidelity Reference Implementation (Mandatory)

When a supplied screen is requested as a high-fidelity reference, treat it as
measurable layout specification rather than broad visual inspiration.

- Establish the target viewport and scale before writing styles. For Mini
  Program references, use the supplied iPhone 13 Pro `390x844` baseline and
  translate reference bounds into `rpx`; do not choose type, icon, or spacing
  values only by visual intuition.
- Record and compare first-viewport anchors: status/header, brand lockup,
  location control, title block, supporting copy, hero/card overlap, section
  headings, card grid, project card, and TabBar. Do not make a later section
  fit by silently shrinking earlier typography or visual assets.
- Type is part of the composition. Match font size, weight, line height,
  manual line breaks, and the gap below multi-line copy as separate values.
  Never reduce readable type merely to keep content in one screen; reclaim
  redundant media height or whitespace first.
- Corner radius is measured geometry, not a default style. Record and compare
  each reference card, button, icon container, and pill radius independently;
  never assume that a button should use `height / 2` or become a full capsule
  when the reference shows a rounded rectangle.
- Size image assets by their visible artwork bounds, not their exported canvas.
  Inspect every raster icon for internal whitespace, crop or prepare a
  production derivative when necessary, and visually compare its *painted*
  size on device. Do not reuse a semantically different generic icon where the
  reference uses a named character or product asset.
- Preserve the reference card proportions for loaded and empty states. Empty
  content may change wording and CTA, but must not expand, compress, or push a
  fixed action card under the custom TabBar.
- For a formal-plan card, surface the real customer and community as the
  project identity (`customer · community`) whenever the linked lead provides
  them. A generated plan name and a date are fallbacks or secondary update
  metadata, never the preferred primary identity.
- A component's state must not silently alter its geometry. For the same
  component across empty, active, completed, and loading states, preserve the
  action's font size, line height, icon size, height, radius, alignment, and
  visual treatment; vary only truthful copy, status semantics, and data. A
  genuinely different treatment must be a separately named, reference-backed
  component variant rather than an incidental state override.
- Adapt height through the scroll container and the native safe area, not by
  relocating a card's internal CTA based on remaining viewport whitespace.
  Reference geometry is width-scaled in `rpx`; short and long devices reveal
  different amounts of the scrollable page without changing component rhythm.
- Equal-priority service cards use equal grid tracks, one shared outer inset,
  and one shared inter-card gap. Do not make a device or utility card narrower
  merely to enlarge a neighboring card; solve dense content with concise,
  complete labels and local hierarchy instead.
- Never truncate a business count or state into an ambiguous fragment such as
  `3 个方…`. Use a concise complete label, or an intentional capped count such
  as `99+`, before considering ellipsis.
- Text-to-background contrast is a mandatory rule for every Mini Program
  surface, not only Hero scenes. Verify every text treatment against its real
  rendered background (including images, gradients, translucent overlays, and
  state changes); do not accept a color because it works only on one region.
  If shadow alone cannot preserve legibility, provide a local contrast surface
  or change the text treatment rather than increasing shadow indefinitely.
  A contrast treatment must protect the glyphs, not introduce a visible block
  or band over an illustration; prefer a restrained text-only shadow or a
  surface already justified by the composition. Do not use an outline unless
  it is visibly present in the approved reference.
- On a scenic Hero, choose display-text color from measured background contrast.
  Where the approved reference calls for white display type, use white with a
  restrained scene-tinted shadow and, where needed, a local contrast surface
  for legibility across light spatial surfaces; do not substitute dark text
  just because one background region is bright.
- Split a compact project card's right column into a top information group and
  a bottom information/action group, then distribute those two groups across
  the card height. Do not vertically center an ungrouped stack. Its CTA aligns
  to the card's existing right content inset in every state.
- QA must include a stable real DevTools screenshot at `390x844`, shown
  side-by-side with the reference at the same scale. Complete a dedicated
  review pass for typography, painted icon size, vertical gaps, and crop
  position before declaring the surface restored. A visually plausible first
  pass is not acceptance.

### Reference Asset Board Workflow (Mandatory)

High-fidelity implementation must not use low-resolution crops taken directly
from a flattened full-page screenshot as production artwork. Prepare and
validate a source asset board before generating or exporting raster assets.

- Inventory the reference before implementation. Keep live copy, counts,
  customer data, statuses, controls, and formal floor-plan geometry in WXML,
  CSS, or canvas code. Only brand characters, scenic objects, decorative
  illustrations, textures, and other genuine raster artwork belong on the
  generated asset board.
- Functional search, filter, add, navigation, and toolbar icons must come from
  one coherent, locally stored, license-documented icon set. They may appear on
  a review board for size and colour comparison, but they must not be
  regenerated as AI illustrations.
- Build a transparent PNG source board with fixed, documented cells before
  generation. Use one logical asset per cell, stable cell coordinates, at
  least `64px` transparent gutters, no labels inside crop regions, no overlap,
  and enough resolution for a maximum `2x` production export. Include the
  approved full-screen reference and canonical brand-IP images as separate
  generation references.
- Keep large Hero or full-bleed background scenes on their own target-ratio
  canvas when their crop, safe area, or lighting depends on the viewport. Do
  not shrink a page background into a small sprite cell merely to place every
  raster in one file.
- Select the image-generation route from the active authentication mode. When
  Codex is using an account login with the built-in image capability, use the
  built-in `imagegen` skill. When Codex is using a relay/API-key provider, use
  the `sub2api-image` skill. Confirm the route without printing credentials,
  do not mix credentials and endpoints, and never silently fall back from one
  route to the other after an error.
- The generation prompt must name the exact board dimensions and cell order,
  require transparent alpha when the selected model supports it, forbid text,
  fake business data, cell dividers, ambient backgrounds, and cross-cell
  shadows, and anchor Xiao K to the approved F1/F3 references. When the selected
  model cannot emit alpha, require one uniform removable background and record
  that compatibility step explicitly.
- Store source boards, prompts, failed generations, cutting scripts, and QA
  boards only under the repository-root `design-references/` directory. They
  are reference artifacts and must remain outside the Mini Program package.
- Inspect the returned board before cutting: verify dimensions, alpha or
  removable-background uniformity, one asset per cell, character anatomy,
  absence of text, cross-cell contamination, and safe painted bounds. A board
  that fails any check must not be exported to production.
- Cut approved boards deterministically by cell coordinates, remove only the
  edge-connected background, then fit each visible artwork bound onto its own
  transparent production canvas. Never hand-crop an approximate rectangle
  from the generated result or the original page screenshot.
- Export only assets referenced by production code into
  `miniprogram/images/<surface>/`. Preserve alpha, keep small UI assets at no
  more than `2x` their displayed size and within the package-size limits below,
  and leave unused variants in `design-references/`.
- Complete real-device or current-window WeChat DevTools QA at `390x844` after
  integration. Compare painted size, crop position, alpha halos, compression,
  loading, and overlap against the reference before accepting the restoration.

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
