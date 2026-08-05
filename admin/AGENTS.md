# Admin Directory Instructions

Read the repository-level `../AGENTS.md` first. The current admin feature map is
`../docs/admin-system-modules.md`; its Chinese mirror is
`../docs/admin-system-modules.zh-CN.md`.

## Runtime And Architecture

- This is a Next.js 16 App Router application using React 19, Tailwind CSS 4,
  shadcn/ui, Radix primitives, Mongoose, and MongoDB.
- The local development server runs on port `3005` (`npm run dev`).
- UI routes live under `src/app/(admin)`, with platform and merchant route groups.
- API routes live under `src/app/api`; shared auth, tenant, workflow, AI, WeCom,
  and survey adapters live under `src/lib`.

## Required Patterns

- Use `withTenantRoute`, `withTenantContext`, `resolveMiniProgramContext`, and the
  Mongoose tenant plugin instead of duplicating authentication or enterprise
  filtering logic.
- Check the endpoint role boundary and whether a route supports platform-wide
  `global_tenant_id` before reading or mutating tenant data.
- Add reusable UI to `src/components/ui/*` and use existing shadcn/Radix controls
  in business pages. Do not introduce Base UI or arbitrary hard-coded styling.
- Every visible admin mutation uses the shared operation feedback UI for success
  and failure. Native `alert()` is not normal feedback.
- When adding a page or menu, update Sidebar permissions, route guards, default
  role permissions, and the admin module inventory together.

## Mandatory Module Preflight And Handoff

Before changing any backend page, API, model, workflow, or shared component,
read `../AGENTS.md` and the applicable sections of both admin module inventories.
Before handoff, update both inventories in the same change with the new route/API,
model or data behavior, permission boundary, status, and limitations. Treat a
missing documentation update as incomplete work; if the change has no functional
impact, record that explicitly in the handoff.

For any Admin UI refactor, also read `../docs/admin-ui-refactor.md` and
`../docs/admin-ui-refactor.zh-CN.md` before selecting a route. Their route ledger
is authoritative for refactor recency and reopen conditions: a generic request to
continue refactoring may select only an unrecorded or explicitly queued route.
Update the route's latest record in both files before handoff, including scope,
verification, remaining visual QA, and the concrete trigger required to revisit
the route. Do not reselect a `Hold` route merely because it shares a convenient
`ProTable` pattern with another page.

## Verification And Documentation

- Run `npm run lint` for UI/API changes and `npm run build` when route or schema
  changes could affect the production bundle.
- Update both admin module documents whenever routes, APIs, permissions, models,
  or workflows change. Mark features `Implemented`, `Limited`, or `Placeholder`
  based on executable behavior, not mock data or planned UI.
