# Smart Floor Planner Mini Program Design Spec

## 1. Purpose

This document defines the visual design rules for the Smart Floor Planner mini program.
It should be treated as the source of truth for UI generation, page redesign, and component styling.

Primary visual reference:
- `miniprogram/ChatGPT Image 2026年4月28日 16_27_02.png`

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

### Forbidden Color Behavior
- Do not replace the primary green with blue or purple
- Do not use saturated red as a major UI theme
- Do not use black backgrounds for standard business pages

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
- `miniprogram/ChatGPT Image 2026年4月28日 16_27_02.png`

Recommended instruction template:

`Please strictly follow miniprogram/DESIGN.md, miniprogram/design-tokens.json, and miniprogram/app.wxss. Use the image file as visual reference only. Prefer existing var(--...) globals over hardcoded values. Do not change the brand color system, radius system, typography hierarchy, button style, or illustration direction unless explicitly requested.`
