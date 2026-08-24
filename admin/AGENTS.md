# Admin Directory Instructions

Read the repository-level `../AGENTS.md` first. The current admin feature map is
`../docs/admin-system-modules.md`; its Chinese mirror is
`../docs/admin-system-modules.zh-CN.md`.

## Runtime And Architecture

- This is a Next.js 16 App Router application using React 19, Tailwind CSS 4,
  Ant Design 5, Ant Design Pro, Mongoose, and MongoDB. Keep
  `@ant-design/v5-patch-for-react-19` loaded from the root client patch so
  Ant Design 5 wave effects and static methods work on React 19.
- The local development server runs on port `3006` (`npm run dev`).
- UI routes live under `src/app/(admin)`, with platform and merchant route groups.
- API routes live under `src/app/api`; shared auth, tenant, workflow, AI, WeCom,
  and survey adapters live under `src/lib`.

## Required Patterns

- Use `withTenantRoute`, `withTenantContext`, `resolveMiniProgramContext`, and the
  Mongoose tenant plugin instead of duplicating authentication or enterprise
  filtering logic.
- Check the endpoint role boundary and whether a route supports platform-wide
  `global_tenant_id` before reading or mutating tenant data.
- Follow the established Ant Design/Admin Pro direction and shared
  `AdminAntdProvider` token configuration. Add reusable Admin controls to
  `src/components/admin/*` or established business-component areas; do not
  introduce a parallel UI system, Base UI, or arbitrary hard-coded styling.
- Every visible admin mutation uses the shared operation feedback UI for success
  and failure. Native `alert()` is not normal feedback.
- When adding a page or menu, update Sidebar permissions, route guards, default
  role permissions, and the admin module inventory together.

## Mandatory Module Preflight And Handoff

Before changing any backend page, API, model, workflow, or shared component,
read `../AGENTS.md` and the applicable sections of both admin module inventories.
Before handoff, update both inventories in the same change with the new route/API,
model or data behavior, permission boundary, status, and limitations. Replace
the affected current entry; do not append a change log. If the change has no
functional impact, state that explicitly in the handoff.

For any Admin UI refactor, also read `../docs/admin-ui-refactor.md` and
`../docs/admin-ui-refactor.zh-CN.md` before selecting a route. Their route ledger
is authoritative for refactor recency and reopen conditions: a generic request to
continue refactoring may select only an unrecorded or explicitly queued route.
Replace the route's current record in both files before handoff, including scope,
concise verification, remaining visual QA, and the concrete trigger required to
revisit the route. Do not reselect a `Hold` route merely because it shares a
convenient `ProTable` pattern with another page.

The bilingual Admin UI refactor contract and existing Ant Design/Admin Pro
routes are the confirmed source for functional Admin work. A separate mockup is
needed only for a user-requested new visual direction or an explicit ledger
requirement.

## Verification And Documentation

- Run `npm run lint` for UI/API changes and `npm run build` when route or schema
  changes could affect the production bundle.
- Update both admin module documents whenever routes, APIs, permissions, models,
  or workflows change. Mark features `Implemented`, `Limited`, or `Placeholder`
  based on executable behavior, not mock data or planned UI.
