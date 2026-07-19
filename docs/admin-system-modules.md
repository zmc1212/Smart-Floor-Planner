# Admin System: Current Module Inventory

This is the current implementation inventory for `admin/`. Verify code first;
update this file and `admin-system-modules.zh-CN.md` when a route, API, model,
permission, or workflow changes.

## Status And Scope

- `Implemented`: a real page/API/data path exists.
- `Limited`: the path works only for a defined role, provider, source shape, or
  operational condition.
- `Placeholder`: the UI is present but uses a mock, a planned action, or no real
  persistence/integration.
- Runtime: Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui + Radix,
  Mongoose, MongoDB, Three.js, and SWR-style client fetching.
- Route groups: `(platform)` contains platform/B2B operations; `(merchant)`
  contains enterprise workbench assets; shared pages live directly under
  `(admin)`.

## Shared Architecture

- Shell and navigation: `src/app/(admin)/layout.tsx`, `Sidebar.tsx`,
  `FetchInterceptor.tsx`, and `useCurrentUser`.
- Auth and tenant context: `src/lib/auth.ts`, `session.ts`, `proxy.ts`,
  `tenant-context.ts`, `tenant-route.ts`, and `miniprogram-auth.ts`.
- Tenant isolation: `withTenantRoute`, `withTenantContext`, tenant resolvers,
  and `multiTenantPlugin`. Platform admins can switch the global view through
  the `global_tenant_id` cookie.
- Roles: `super_admin`, `admin`, `enterprise_admin`, `designer`, `salesperson`,
  `measurer`, and `viewer`. Menu keys and defaults are defined in
  `models/AdminUser.ts`; custom roles are in `models/SystemRole.ts`.
- Shared feedback: visible mutations use `components/ui/operation-feedback`;
  normal operations do not use raw `alert()`.

## Functional Modules

### 1. Authentication, Registration, And Session

- Pages: `/login`, `/register`.
- APIs: `/api/auth/login`, `/logout`, `/me`, `/miniprogram`,
  `/register-company`, `/register-enterprise`.
- Models/helpers: `AdminUser`, `User`, `Enterprise`, session/auth helpers, and
  `miniprogram-jwt`.
- Status: `Implemented`. Supports admin sessions, enterprise registration,
  Mini Program identity binding, JWT/cookie handling, and unauthorized redirects.
- User audit pages: `/users` and `/users/[openid]`, backed by `/api/users`,
  `/users/[openid]`, and `/users/me`, provide Mini Program user lookup and the
  user's associated floor-plan export library (`Implemented`).

### 2. Navigation, Roles, And Access Control

- Page: `/roles`, plus route guards and the shared Sidebar.
- APIs: `/api/roles`, admin-user APIs, staff APIs, and department APIs.
- Status: `Implemented`. Menu visibility, effective permissions, role defaults,
  custom role menu keys, account status, department membership, and route-level
  role checks are active.

### 3. Platform Dashboard And Enterprise Tenants

- Pages: `/`, `/enterprises`, `/enterprises/[id]`, and enterprise AI,
  automation, and WeCom subpages.
- APIs: `/api/admin/enterprises`, `/activate`, `[id]`, `[id]/ai-key`,
  `[id]/ai-sync`, `[id]/ai-usage`, and `/api/branding/[id]`.
- Models/helpers: `Enterprise`, `EnterpriseAiUsageSnapshot`, `AdminUser`,
  `enterprise-ai`, and `enterprise-wecom`.
- Status: `Implemented`. Covers enterprise onboarding/activation, tenant profile,
  branding, automation settings, WeCom configuration, AI provider/key runtime
  settings, usage snapshots, and platform-level overview metrics.

### 4. Staff, Departments, And System Accounts

- Pages: `/staff`, `/admins`.
- APIs: `/api/staff`, `/staff/[id]`, `/departments`, `/departments/[id]`,
  `/admin-users`, and `/admin-users/[id]`.
- Models: `AdminUser`, `Department`, and `SystemRole`.
- Status: `Implemented`. Enterprise staff, platform admins, role assignment,
  department trees, status changes, and promoter/designer/measurer relationships
  are supported.

### 5. B2B Promotion And Collaboration Workflow

- Pages: `/promotion-records`, `/workflow-logs`.
- APIs: promotion records, `/promotion-records/pool`, `/conflicts`, platform
  promotion config, workbench summary/todos, notification logs, and reminder run.
- Models/helpers: `PromotionEnterpriseRecord`, `WorkflowNotificationLog`,
  `promotion-workflow`, `promotion-timeline`, `workflow-automation`, WeChat,
  and WeCom notification helpers.
- Status: `Implemented`. Includes reporting, duplicate/conflict handling, public
  pool, claim/approval, assignment, business stages, follow-up timelines, SLA
  reminders, notification deduplication, and audit logs.

### 6. Packages, Orders, And Commissions

- Pages: `/packages`, `/enterprise-orders`, `/commissions`.
- APIs: `/api/admin/packages`, `/enterprise-orders`, `/commissions`, settlement,
  and commission-record endpoints.
- Models: `Package`, `EnterpriseOrder`, `CommissionRecord`.
- Status: `Implemented`. Supports package catalog, enterprise order lifecycle,
  paid-order commission creation, commission listing, settlement, and voiding.

### 7. Leads And Conversion Assets

- Page: `/leads`.
- APIs: `/api/leads`, `/leads/[id]`, `/leads/[id]/share`, and related floor-plan
  and staff endpoints.
- Models/helpers: `Lead`, `FloorPlan`, `AdminUser`, WeChat, and WeCom helpers.
- Status: `Implemented`. Covers lead intake/status, follow-ups, assignment,
  formal floor-plan association, share links, and conversion context.

### 8. Formal Floor Plans, Search, And Viewing

- Pages: `/floorplans`, `/floorplans/[id]`, `/floorplans/kujiale`, `/measurements`.
- APIs: `/api/floorplans`, `/floorplans/[id]`, `/floorplans/[id]/export/dxf`,
  `/measurements`, `/kujiale/cities`, `/kujiale/floorplans/search`, and lead
  Kuaile floor-plan association.
- Components/helpers: `FloorPlanViewer`, `FloorPlanViewerWrapper`, `survey-graph`,
  and `dxf`.
- Status: `Implemented` for formal v4 wall-graph parsing, admin 2D/3D viewing,
  measurement filtering, and DXF download. Kujiale search is `Limited` by the
  upstream search/provider response and city/query availability.
- Boundary: the backend derives room/opening render data from `surveyGraph`; it
  does not persist legacy `rooms` or other old layout fields.

### 9. Measurement Audit And BLE Device Assets

- Page: `/devices` and the measurement record view under `/measurements`.
- APIs: `/api/devices`, `/devices/[id]`, `/devices/verify`,
  `/devices/verify-binding`, and `/api/measurements`.
- Models: `Device`, `Measurement`, and `User`.
- Status: `Implemented`. Supports device pool, enterprise/user binding,
  verification, status management, and formal length/height/area/angle/opening
  audit records with BLE, manual, or system source markers.

### 10. AI Studio And Design Generation

- Pages: `/ai-studio/designer`, `/ai-studio/scenarios`, scenario detail,
  `/ai-studio/floor-plan`, floor-plan detail, `/ai-studio/furnishing`,
  `/ai-studio/soft-furnishing`, `/inspirations`, and `/ai-presets`.
- APIs: AI agent/chat, generation/render/advice, status/history, quota/usage,
  presets, workflows and stages, workflow source images/leads, media assets,
  generation images, image proxy, soft-furnishing render, and inspirations.
- Models/helpers: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`,
  `AiQuota`, `EnterpriseAiUsageSnapshot`, `MediaAsset`, `Inspiration`, and
  `src/lib/ai/*`.
- Status: `Implemented` for chat, scenario workflows, formal floor-plan input,
  style/furnishing/soft-furnishing rendering, history, quotas, presets, and
  persisted media. Provider availability and enterprise AI configuration make
  some generation paths `Limited`.

### 11. Mini Program Support And Cross-Client APIs

- APIs: `/api/auth/miniprogram`, `/api/miniprogram/home`, `/mine`,
  `/api/users/me`, `/location/reverse`, `/branding/[id]`, plus shared leads,
  floor-plans, measurements, commissions, orders, and promotion APIs.
- Status: `Implemented`. These endpoints resolve Mini Program identity,
  professional context, home dashboard, mine/workbench data, location, branding,
  and shared business assets.

### 12. Notifications, Automation, And Diagnostics

- APIs: `/api/automation/reminders/run`, workflow notification list/poll,
  `/api/health`, `/api/debug`, `/api/debug/tenant-context`, and
  `/api/internal/seed`.
- Status: `Implemented` for scheduled reminder execution, browser polling,
  notification logs, health/debug checks, seed support, and Docker/release
  tooling. These endpoints require their documented role or operational context.

## Core Models

- Identity: `AdminUser`, `SystemRole`, `User`, `Department`.
- Tenant/commercial: `Enterprise`, `Package`, `EnterpriseOrder`,
  `CommissionRecord`, `PromotionEnterpriseRecord`.
- Customer assets: `Lead`, `FloorPlan`, `Measurement`, `Device`, `Inspiration`.
- AI/media: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`,
  `AiQuota`, `EnterpriseAiUsageSnapshot`, `MediaAsset`.
- Notifications/config: `WorkflowNotificationLog`, `PlatformConfig`.

## Maintenance Checklist

Before changing an admin page, API, model, workflow, or shared component, read
the root and directory-level instructions plus both admin inventories. When the
change is complete, update both inventories in the same diff with the route/API,
data behavior, permission boundary, status, and limitations. Check Sidebar menu
keys, `proxy.ts`, role defaults, tenant resolution, model indexes, and operation
feedback. Do not document a roadmap item as implemented until a real route,
handler, and persistence/provider path exists. A change with no functional impact
must say so explicitly in its handoff.
