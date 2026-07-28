# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Primary users are enterprise staff working in renovation lead and delivery workflows, including salespeople, surveyors, designers, enterprise administrators, and platform administrators. They use the Mini Program while following customers, carrying out on-site surveying, reviewing design work, and coordinating business tasks.

Ordinary Mini Program users are a secondary audience. They primarily review their floor plans and continue into measurement or AI-assisted design.

## Product Purpose

Smart Floor Planner connects renovation leads, formal surveying, floor-plan records, and AI-assisted design in one workflow shared by the administration system and the native WeChat Mini Program.

For the Mini Program Mine surface, success means that enterprise staff can quickly understand what needs attention, scan their role-specific work summary, and enter their most common tools. Ordinary users should be able to identify their account and continue working with their floor plans without navigating an enterprise dashboard.

## Positioning

The product keeps the commercial renovation workflow and the formal measured wall graph in the same tenant-aware system. Downstream floor-plan viewers, exports, 3D, and AI use derived read models from the formal version-4 surveying graph instead of maintaining competing editable layout copies.

## Operating Context

- Enterprise staff use the Mini Program both in the office and at renovation or surveying sites.
- The Mine page is a role-aware personal workbench rather than a public social profile.
- Core Mine-page tasks include reviewing todos and workbench metrics, entering leads, promotion records, commissions, formal surveying, AI design, floor plans, notifications, and account actions.
- Authentication and enterprise context are shared with the administration system through the Mini Program API.

## Capabilities and Constraints

- Runtime: native WeChat Mini Program with a custom tab bar.
- Admin sessions and Mini Program sessions use different authentication surfaces but share tenant-aware business data.
- The Mine page must preserve role-specific server data and existing navigation boundaries.
- Formal surveying must only enter `pages/surveying-editor/surveying-editor` with `leadId` and/or `floorPlanId`.
- Formal `FloorPlan.layoutData` is the version-4 surveying wall graph contract documented by the repository.
- The primary visual QA viewport is iPhone 13 Pro at `390x844`.
- Primary product action icons must be coherent, locally stored, and license-documented; emoji and mixed Unicode symbols are not product icons.
- Some notification and account actions are informational or platform-mediated rather than full configuration APIs.

## Brand Commitments

- Product name: Smart Floor Planner / 智能量房大师.
- The existing Mini Program brand is fresh, approachable, home-focused, and led by bright green.
- The redesign must continue to follow `miniprogram/DESIGN.md`, `miniprogram/design-tokens.json`, and the global variables in `miniprogram/app.wxss`.
- The user explicitly requested that the Mine page be redesigned using current Huaban or comparable mobile design references as inspiration.

## Evidence on Hand

- Current Mini Program module inventory: `docs/miniprogram-system-modules.md` and `docs/miniprogram-system-modules.zh-CN.md`.
- Mini Program visual contract: `miniprogram/DESIGN.md`, `miniprogram/design-tokens.json`, and `miniprogram/app.wxss`.
- Current Mine implementation: `miniprogram/pages/mine/mine.*`.
- Existing local Mine-page visual evidence and assets: `design-mockups/mine.png` and `miniprogram/images/mine-*.png`.
- Current routes, APIs, schemas, and tests remain authoritative; planning documents do not prove implementation.
- No testimonials, customer claims, or performance benchmarks are confirmed for use in the product UI.

## Product Principles

- Put the user's next operational task ahead of decorative profile content.
- Preserve role and tenant boundaries while making the interface easier to scan.
- Keep formal surveying as one authoritative wall-graph workflow.
- Present AI assistance as part of a real customer and floor-plan workflow, not as an isolated novelty.
- Treat repository documentation as durable product memory and update it with behavior changes.

## Accessibility & Inclusion

- Keep primary actions comfortably tappable and readable on the `390x844` baseline.
- Do not rely on color alone for status meaning.
- Allow dynamic lists and accessibility text to scroll while avoiding unnecessary spacing that hides critical fixed-content actions.
