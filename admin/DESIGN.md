# Smart Floor Planner Admin Design Spec

## 1. Purpose

This document defines the visual design rules for the Smart Floor Planner admin console.
It should be treated as the source of truth for admin-side UI generation, redesign, and component styling.

Primary references:
- `miniprogram/DESIGN.md`
- `admin/src/app/globals.css`
- `admin/src/components/ui/button.tsx`
- `admin/src/components/ui/card.tsx`
- `admin/src/components/ui/badge.tsx`

When references conflict:
- Follow this document first
- Follow `miniprogram/DESIGN.md` for shared brand direction second
- Follow existing admin implementation tokens in `globals.css` third

## 2. Relationship To Mini Program

The admin console and mini program must feel like parts of the same product family.

Shared brand requirements:
- keep the bright, calm, home-focused feeling
- keep green as the core brand signal
- keep generous card spacing and soft surfaces
- keep the product approachable rather than overly technical

Admin-side differences:
- higher information density than the mini program
- stronger emphasis on data scanning, workflow status, and operational efficiency
- more use of neutral structure colors so business content stays legible
- accent colors may be used for modules, but green remains the primary product action color

## 3. Brand Direction

### Keywords
- clean
- calm
- professional
- efficient
- friendly
- home-service oriented
- trustworthy

### Emotional Tone
- Make daily operations feel ordered and low-stress
- Make data management feel clear instead of bureaucratic
- Make AI tools feel practical and supportive, not experimental
- Prefer soft confidence over cold enterprise severity

### Avoid
- pure Vercel-style monochrome minimalism as the main theme
- purple-first or blue-first branding
- dark dashboard styling as the default experience
- cramped table-heavy screens without visual hierarchy
- overly decorative gradients that distract from business tasks

## 4. Visual Principles

### Overall Look
- Use bright page backgrounds and white card surfaces
- Preserve roomy layouts even when showing dense business data
- Use green for primary actions, active emphasis, success states, and brand recall
- Use neutral shells so charts, badges, and business statuses remain easy to scan

### Composition
- Prefer modular cards, split panels, and clear page sections
- Important actions should sit near the content they affect
- Dashboards should group information by task, not by raw database entity
- AI workflows may feel slightly more expressive, but must still stay within the brand system

### Density
- Medium density
- Higher than the mini program, lower than a traditional enterprise ERP
- Data should be easy to scan without becoming visually loud

## 5. Color System

### Shared Brand Primary
- Primary 100: `#22C55E`
- Primary 80: `#6FD77B`
- Primary 60: `#9BE7A7`
- Primary 40: `#C7F1CC`
- Primary 20: `#EAF8EC`

### Admin Neutrals
- Neutral 950: `#171717`
- Neutral 900: `#1F2937`
- Neutral 700: `#4B5563`
- Neutral 500: `#6B7280`
- Neutral 300: `#D1D5DB`
- Neutral 100: `#F3F4F6`
- White: `#FFFFFF`

### Supporting Accent Colors
- Info Blue: `#3B82F6`
- Warm Orange: `#F59E0B`
- Soft Pink: `#FF8BA7`
- Mint Accent: `#8FD19E`
- Cyan Mint: `#A8E6CF`

### Usage Rules
- Green is the default for primary CTA, active emphasis, positive result, and main product identity
- Dark neutrals are used for headings, key values, and dense content
- Mid neutrals are used for helper text, metadata, and less critical labels
- Light neutrals are used for page backgrounds, dividers, muted surfaces, and input shells
- Blue and orange may be used for module distinction or workflow context, but should not replace brand green at the product level

### Forbidden Color Behavior
- Do not shift the admin console into a black-and-white-only Vercel clone
- Do not use purple as the default primary action color
- Do not make dark mode the assumed visual direction unless explicitly requested
- Do not use saturated red as a dominant page color outside error or destructive actions

## 6. Typography

### Font Family
- Primary: `Geist Sans`
- Mono / technical labels: `Geist Mono`
- Chinese fallback: `PingFang SC`, `Microsoft YaHei`, `sans-serif`

### Type Scale
- Page Title: `28px`, `700`
- Section Title: `20px`, `600`
- Card Title: `16px`, `600`
- Body Text: `14px`, `400`
- Secondary Text: `12px`, `400`
- Data Label / Micro Meta: `10px` to `12px`, `600` to `700`

### Text Rules
- Titles should be direct and operational, not marketing-heavy
- Large data values may use stronger weight and tighter tracking
- Metadata may use uppercase sparingly for compact labels and KPI chips
- Avoid stacking too many weight changes inside a single module
- Prefer readability in Chinese interfaces over aggressive display typography

## 7. Radius And Shadow

### Radius
- `8px`
- `12px`
- `16px`
- `20px`
- `24px`
- `32px`

### Preferred Usage
- Small buttons and compact controls: `8px` to `12px`
- Inputs, filters, and small cards: `12px` to `16px`
- Standard cards and panels: `16px` to `24px`
- Hero cards, dashboards, AI highlights: `24px` to `32px`

### Shadow
- Soft Card: `0 1px 2px rgba(0,0,0,0.06)`
- Standard Card: `0 8px 24px rgba(15,23,42,0.08)`
- Feature Panel: `0 16px 40px rgba(15,23,42,0.10)`

### Shadow Rules
- Shadows should separate layers gently, not feel dramatic
- Standard data cards should rely more on white surface + border + light shadow than on heavy depth
- Feature modules may use stronger shadows, but only one emphasis layer per area

## 8. Component Rules

### App Shell
- Use a light page canvas with clear content zones
- Sidebar, top bar, and content panels should feel stable and low-noise
- Navigation emphasis should come from spacing, active state, and surface contrast more than from heavy decoration

### Cards
- White surface
- Rounded corners, usually `xl` or larger
- Soft border and soft shadow
- Header, content, and footer spacing should be generous and consistent
- KPI cards may use stronger icon blocks or tinted chip accents

### Buttons
- Primary button: green fill, white text
- Secondary button: white or muted surface, dark text, soft border
- Outline button: subtle border, light hover fill
- Destructive button: reserved for delete, revoke, or irreversible operations
- AI workflow buttons may use supporting accent colors, but only when they represent a clearly scoped feature area

### Badges And Status Chips
- Use rounded pill shapes
- Default informational badges should be soft and compact
- Status colors should be tinted backgrounds with readable text, not flat saturated blocks

Suggested status mapping:
- Measuring: green family
- Designing / In Progress: blue family
- Converted / Completed: orange or green family
- Error / Failed: red family
- Disabled / Cancelled: gray family

### Inputs And Filters
- Prefer soft neutral backgrounds and restrained borders
- Search, select, date filter, and segmented controls should align visually
- Dense filter bars must still breathe with consistent gap and padding

### Tables And Lists
- Use tables only when comparison across rows matters
- Prefer card lists when records need richer context or actions
- Row actions should be visible but not overpowering
- Empty rows and loading states should feel intentional and guided

## 9. Page Patterns

### Dashboard / Overview
- Use KPI cards first
- Follow with recent activity, pending tasks, and operational shortcuts
- Keep summary modules visually grouped by job-to-be-done

### Management Lists
- Use page title + summary + filters + result list
- Each record should expose primary identity, status, and next action quickly
- Metadata should be secondary and visually lighter

### Detail Pages
- Use split layout when preview + metadata + actions coexist
- Keep destructive operations away from primary task flows
- AI result pages may use larger media containers and richer side panels

### AI Studio Pages
- May feel slightly more visual than standard admin pages
- Use gradients, dark preview areas, or highlight panels sparingly
- Even expressive pages must still inherit the admin brand system and not drift into unrelated purple-first aesthetics

### Empty States
- Use warm neutral or green-tinted surfaces
- Include one clear next action
- Tone should be encouraging and action-oriented

## 10. Motion Guidance

### Motion Style
- subtle
- fast
- smooth
- task-focused

### Recommended Motion
- hover shadow increase on cards
- button press feedback
- loading spinner or pulse for async tasks
- panel and modal fade or rise
- lightweight transitions for filter and tab switching

### Avoid
- flashy hero motion
- large elastic transitions
- attention-grabbing animation on standard management pages

## 11. Implementation Rules For AI

When generating or refactoring admin UI:
- Follow `miniprogram/DESIGN.md` for shared brand personality
- Adapt layouts for admin density and operational workflows
- Prefer bright surfaces, clear cards, and soft hierarchy
- Keep green as the primary brand action color
- Use supporting accent colors only where business context benefits from them
- Preserve readable Chinese-first business UI hierarchy

Do not:
- re-theme admin pages into a pure Vercel clone
- default to purple gradient CTA systems
- introduce dark-first enterprise styling as the dominant look
- overuse raw black panels outside focused highlight sections

## 12. Current Implementation Layer

The current admin implementation uses:
- `admin/src/app/globals.css`
- shadcn-style semantic tokens such as `--background`, `--foreground`, `--primary`, `--muted`, `--border`
- `Geist Sans` and `Geist Mono` from `next/font/google`

### Current Constraints
- The global `--primary` token is still neutral rather than green
- Several business pages already use green, emerald, blue, and orange accents directly in component class names
- Some AI pages still use purple-forward styling, which should be treated as transitional rather than canonical

### Canonical Direction
- Future UI work should move the admin system toward the shared green brand
- New pages should prefer semantic tokens or reusable utility patterns rather than isolated hardcoded colors
- Existing purple-first AI screens should gradually align with the green-led product system unless a scoped feature reason prevents it

## 13. Preferred Token Direction

For future admin token cleanup, prefer this mapping:

### Brand And Surface
- `--background`: soft light page background
- `--foreground`: primary dark text
- `--card`: white card surface
- `--card-foreground`: primary dark text on cards
- `--primary`: brand green
- `--primary-foreground`: white

### Supportive UI
- `--secondary`: soft neutral surface
- `--muted`: low-contrast neutral fill
- `--muted-foreground`: secondary text
- `--border`: soft neutral divider
- `--ring`: green or green-tinted focus ring

### Destructive
- `--destructive`: restrained error red
- `--destructive-foreground`: readable light text or matching semantic foreground

## 14. Variable Usage Rules

For all future admin implementation:
- Prefer semantic tokens from `admin/src/app/globals.css`
- When semantic tokens are insufficient, use a shared brand scale derived from `miniprogram/DESIGN.md`
- Prefer reusable utility classes and component variants over one-off hardcoded styles
- Keep page-specific accents scoped and justified

### Examples
- Primary submit button: brand green background + white text
- Standard page background: semantic background token
- Main card background: semantic card token
- Secondary helper text: muted foreground token
- Badge and chip colors: tinted semantic or business-status colors

## 15. Instruction Template For Future AI Tasks

Use this instruction template in future admin implementation tasks:

`Please strictly follow admin/DESIGN.md, reference miniprogram/DESIGN.md for shared brand direction, and prefer admin/src/app/globals.css semantic tokens over hardcoded values. Keep the admin console bright, card-based, and green-led. Do not revert to a Vercel-style monochrome theme or introduce purple-first branding unless explicitly requested.`

## 16. File Usage Guidance

For AI-assisted admin implementation, always provide:
- `admin/DESIGN.md`
- `miniprogram/DESIGN.md`
- `admin/src/app/globals.css`
- relevant page and component files under `admin/src`

Recommended instruction template:

`Please strictly follow admin/DESIGN.md and miniprogram/DESIGN.md. Use admin/src/app/globals.css semantic tokens whenever possible. Keep the admin UI bright, calm, operationally clear, and aligned with the green home-design brand. Treat existing purple-first AI styles as non-canonical unless explicitly preserved.`
