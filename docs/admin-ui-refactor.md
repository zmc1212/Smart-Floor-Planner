# Admin UI Refactor

## Goal

Keep the existing Next.js App Router and server-side business APIs while
introducing a consistent admin application layer based on Ant Design and
Ant Design ProComponents.

The first milestone is the AI provider management surface. It is the reference
implementation for future page migrations and must be accepted before the
remaining admin pages are migrated.

## Target Stack

- Next.js App Router remains the routing and deployment runtime.
- `antd` supplies the base controls and visual tokens.
- `@ant-design/pro-components` supplies `ProTable`, `ProForm`,
  `ProDescriptions`, `PageContainer`, and `ProLayout`-compatible patterns.
- `@ant-design/nextjs-registry` prevents CSS-in-JS style flashes in App Router.
- Existing API routes, JWT/cookie authentication, tenant helpers, SWR hooks,
  Mongoose models, and operation feedback remain authoritative.

## Routing Contract

The first migrated module uses real URL boundaries:

- `/ai-providers`: provider list, provider creation entry, and operational actions.
- `/ai-providers/new`: create a provider.
- `/ai-providers/[id]`: view and edit one provider.
- `/ai-models`: platform image-model catalog, default-model selection, enablement,
  and reference-image limits. It reuses the `ai-providers` platform permission.

List actions that change configuration must navigate to a route. Operational
actions such as connectivity testing, balance lookup, model sync, and disabling
remain in a row action menu and use the shared operation feedback UI.

## Shared UI Contract

- One light admin shell with a stable sidebar and a constrained content region.
- Route metadata lives in `admin/src/config/admin-routes.ts` and is reused by
  navigation, breadcrumbs, and page headers.
- Migrated management pages use ProComponents `PageContainer` for the page-level
  title area. Its `title`, `content`, `onBack`, and `extra` props are the
  standard for page title, description, return navigation, and page actions;
  do not create a page-specific header component or hand-assemble this pattern.
- `PageContainer` provides the page header and content boundary, but it does not
  space business blocks. The shared admin shell gives the children container a
  `24px` top inset below the header divider; pages must not add a second manual
  top margin for the first block. Pages with multiple blocks wrap them in `Flex
  vertical gap={24}` (or a documented ProComponents `ProCard`/Ant Design
  `Space` layout).
- New management lists use `ProTable` or the shared table wrapper, with a single
  filter row, consistent pagination, status tags, and a final action column.
- New forms use `ProForm` controls and a single primary submit action.
- Provider forms are driven by `src/lib/ai/provider-adapter-manifest.ts`. The
  shared page renders common endpoint, credential, capability, routing, and
  cost controls first; an adapter may declare narrowly scoped config fields
  only where its protocol requires them. The backend validates the same
  declaration before saving `adapterConfig`.
- Provider credentials retain the legacy encrypted `apiKey` fields for current
  runtime compatibility and also write masked/encrypted credential maps. A new
  adapter must declare and consume any additional credential fields in its
  server adapter; adding a frontend label alone is not an integration.
- Details use `ProDescriptions` for read-only metadata and grouped sections for
  editable configuration.
- `ProForm` submit actions use its `submitter.render` hook with the shared
  `Flex` action row and a `24px` top gap from the final content block.
- Use Ant Design `Flex` or `Space` with explicit gaps for sibling layout: `24px`
  between page sections and `16px` inside a configuration section unless the
  content relationship requires another documented value. Do not create spacing
  by stacking child margins.
- Use `Select` or `ProFormSelect` for option sets. Where a known option set also
  permits a new value, use `Select mode="tags"`; do not recreate a select with
  `Input` plus `datalist` or another raw HTML control.
- All visible mutations continue to call `components/ui/operation-feedback`.
- No raw native `select`, checkbox, radio, `datalist`, or `alert()` is introduced
  in the migrated surface.

## Migration Sequence

1. AI providers: list, create, detail/edit, and the separate platform model catalog.
2. AI presets and AI credit prices.
3. Media storage and platform configuration pages.
4. Enterprise, staff, orders, and promotion management pages.
5. Merchant workbench pages and AI creation surfaces after their interaction
   contracts are audited separately.

Each step must preserve route permissions, tenant boundaries, APIs, models, and
documented limitations. A page is considered migrated only after lint, build,
desktop/mobile visual checks, and browser verification pass.

## Migration Progress

- The AI provider, image-model catalog, AI preset, and AI credit-price surfaces
  use the shared Ant Design ProComponents page patterns.
- `/media-storage` now uses `PageContainer`, Ant Design configuration panels,
  `ProTable`, and `ModalForm`. The existing storage APIs, `media-storage`
  permission boundary, encrypted credentials, test-before-activation rule, and
  archive behavior are unchanged.
- `/enterprises` now uses `PageContainer` and `ProTable` for enterprise search,
  pagination, status review, and operational actions. Its existing editor dialog,
  detail page, APIs, and `super_admin`/`admin` platform boundary remain intact;
  the detail and editor presentation migrations are separate follow-up work.
- `/promotion-records` now uses `PageContainer`, `ProTable`, `ProForm`, and
  `ProDescriptions` for the report list, platform protection-rule configuration,
  report detail, follow-up, assignment, pool, and claim-review interactions.
  Its existing PostgreSQL-backed APIs, `salesperson` self-claim boundary, and
  `admin`/`super_admin` configuration and pool-management boundary are unchanged.
- `/staff` now uses `PageContainer`, `ProTable`, `ModalForm`, and Ant Design
  `Tree` for server-paginated staff search, department filtering, and staff or
  department maintenance. The existing tenant-scoped staff/department APIs and
  `enterprise_admin`/`admin`/`super_admin` mutation boundary are unchanged.
- `/enterprise-orders` now uses `PageContainer`, `ProTable`, and `ModalForm`
  for order search, status review, status transitions, enterprise activation,
  and order creation. Its existing PostgreSQL-backed order, package, promotion,
  commission, and activation APIs, plus the `enterprise_admin`/`admin`/
  `super_admin` order-mutation and `admin`/`super_admin` activation boundaries,
  are unchanged.
- Other platform configuration pages remain in the third migration step and
  require their interaction contracts to be audited before implementation.

## Acceptance Criteria For Milestone One

- `/ai-providers/new`, `/ai-providers/[id]`, and `/ai-models` are directly reachable and
  browser back/forward navigation works.
- Provider create/edit, API key rotation, cost rules, connectivity test,
  balance lookup, model sync, disable, and model catalog persistence keep their
  existing API behavior.
- Table, form, select, status, pagination, and row-action styles use the new
  shared visual language.
- The page title, description, return navigation, and page-level primary action
  use `PageContainer`, including on both the list and detail routes.
- Existing shadcn pages continue to compile; no API or permission boundary is
  changed.
- Both admin module inventories describe the new routes and status.

## Explicit Non-Goals

- No migration of the Mini Program.
- No rewrite of unrelated API handlers or Mongoose models.
- No one-shot replacement of every admin page before the first milestone is
  reviewed.
