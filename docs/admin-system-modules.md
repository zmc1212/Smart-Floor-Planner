# Admin Backend System Module Inventory

This document summarizes the current functional modules in the `admin` Next.js backend. Keep `docs/admin-system-modules.zh-CN.md` synchronized whenever routes, APIs, permissions, models, or workflows change.

## Scope

- Application root: `admin/src/app`.
- Framework: Next.js App Router with route groups under `(admin)`, `(platform)`, and `(merchant)`.
- Data layer: MongoDB through Mongoose models in `admin/src/models`.
- Tenant model: most business data is enterprise-scoped through `withTenantContext`, `withTenantRoute`, and `multiTenantPlugin`.
- Main roles: `super_admin`, `admin`, `enterprise_admin`, `designer`, `salesperson`, `measurer`, `viewer`.

## Shared Architecture

- Admin shell: `admin/src/app/(admin)/layout.tsx`, `admin/src/components/Sidebar.tsx`, `admin/src/components/FetchInterceptor.tsx`.
- Auth/session: `admin/src/lib/auth.ts`, `session.ts`, `tenant-context.ts`, `tenant-route.ts`, `miniprogram-auth.ts`, `proxy.ts`.
- UI primitives: `admin/src/components/ui/*`, including shared `operation-feedback`.
- Tenant isolation: model plugins in `admin/src/lib/mongoose-tenant-plugin.ts`; global tenant selection is supported for platform admins through `global_tenant_id`.
- Permissions: menu keys and defaults live in `admin/src/models/AdminUser.ts`; role overrides use `admin/src/models/SystemRole.ts`.

## Functional Modules

### 1. Authentication, Registration, and Session Management

- Pages: `/login`, `/register`.
- APIs: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/miniprogram`, `/api/auth/register-company`, `/api/auth/register-enterprise`.
- Models/libs: `AdminUser`, `User`, `Enterprise`, `session.ts`, `auth.ts`, `miniprogram-jwt.ts`.
- Responsibilities: admin login/logout, session validation, enterprise registration, mini program login binding, JWT/cookie handling, and 401 redirect handling.

### 2. Navigation, Roles, and Access Control

- Pages: shared admin layout plus `/roles`.
- APIs: `/api/roles`.
- Models/libs: `AdminUser`, `SystemRole`, `staff-access.ts`, `proxy.ts`.
- Responsibilities: menu visibility, route permission checks, default role permissions, custom role menu keys, and effective permissions for sidebar rendering.

### 3. Platform Dashboard and Global Operations View

- Pages/components: `/`, `PlatformDashboard`.
- APIs consumed: `/api/users`, `/api/floorplans`, `/api/admin/enterprises`.
- Responsibilities: platform-level metrics for users, floor plan assets, enterprises, and operational health.

### 4. Enterprise Tenant Management

- Pages: `/enterprises`, `/enterprises/[id]`, `/enterprises/[id]/ai`, `/enterprises/[id]/automation`, `/enterprises/[id]/wecom`.
- APIs: `/api/admin/enterprises`, `/api/admin/enterprises/[id]`, `/api/admin/enterprises/activate`, `/api/admin/enterprises/[id]/ai-key`, `/api/admin/enterprises/[id]/ai-sync`, `/api/admin/enterprises/[id]/ai-usage`, `/api/branding/[id]`.
- Models/libs: `Enterprise`, `EnterpriseAiUsageSnapshot`, `AdminUser`, `enterprise-wecom.ts`, `enterprise-ai.ts`.
- Responsibilities: enterprise onboarding, activation, tenant profile, brand colors/logo, automation SLA settings, WeCom settings, enterprise AI key/runtime configuration, and AI usage overview.

### 5. System Administrators, Staff, and Departments

- Pages: `/admins`, `/staff`.
- APIs: `/api/admin-users`, `/api/admin-users/[id]`, `/api/staff`, `/api/staff/[id]`, `/api/departments`, `/api/departments/[id]`.
- Models/libs: `AdminUser`, `Department`, `SystemRole`.
- Responsibilities: platform admin accounts, enterprise staff accounts, staff roles, department tree, status management, and permission assignment.

### 6. B2B Promotion Records and Collaboration Workflow

- Pages: `/promotion-records`, `/workflow-logs`.
- APIs: `/api/promotion-records`, `/api/promotion-records/[id]`, `/api/promotion-records/conflicts`, `/api/promotion-records/pool`, `/api/platform/promotion-config`, `/api/workbench/summary`, `/api/workbench/todos`, `/api/workflow-notification-logs`, `/api/workflow-notification-logs/poll`.
- Models/libs: `PromotionEnterpriseRecord`, `WorkflowNotificationLog`, `promotion-workflow.ts`, `promotion-timeline.ts`, `workflow-automation.ts`, `wechat-notification.ts`.
- Responsibilities: ground-promotion enterprise reporting, duplicate/conflict handling, public pool and claim flow, follow-up SLAs, measurement/design task assignment, business-stage timeline, collaboration todos, reminders, and notification logs.

### 7. Packages, Orders, and Commission Settlement

- Pages: `/packages`, `/enterprise-orders`, `/commissions`.
- APIs: `/api/admin/packages`, `/api/admin/packages/[id]`, `/api/enterprise-orders`, `/api/enterprise-orders/[id]`, `/api/commissions`, `/api/commissions/[id]/settle`, `/api/commission-records`, `/api/commission-records/[id]`.
- Models/libs: `Package`, `EnterpriseOrder`, `CommissionRecord`.
- Responsibilities: package catalog, enterprise transaction orders, promoter commission calculation, commission records, and settlement actions.

### 8. Leads and Customer Conversion

- Pages: `/leads`.
- APIs: `/api/leads`, `/api/leads/[id]`, `/api/leads/[id]/share`.
- Models/libs: `Lead`, `FloorPlan`, `AdminUser`, `wecom.ts`, `wechat-notification.ts`.
- Responsibilities: customer lead intake, status tracking, floor plan association, surveying prototype draft visibility, promoter/designer assignment, follow-up records, WeCom group creation, and lead sharing.

### 9. Floor Plans, Measurement Records, and Devices

- Pages: `/floorplans`, `/floorplans/[id]`, `/measurements`, `/devices`.
- APIs: `/api/floorplans`, `/api/floorplans/[id]`, `/api/floorplans/[id]/export/dxf`, `/api/measurements`, `/api/devices`, `/api/devices/[id]`, `/api/devices/verify`, `/api/devices/verify-binding`.
- Models/libs: `FloorPlan`, `Measurement`, `Device`, `User`, `dxf.ts`, `FloorPlanViewer`.
- Responsibilities: measured floor plan storage, layout viewing, read-only surveying prototype wall-graph display, DXF export for formal layouts, BLE measuring device management, device binding verification, and measurement audit logs.

### 10. AI Studio and Design Generation

- Pages: `/ai-studio/designer`, `/ai-studio/scenarios`, `/ai-studio/scenarios/[id]`, `/ai-studio/floor-plan`, `/ai-studio/floor-plan/[id]`, `/ai-studio/furnishing`, `/ai-studio/soft-furnishing`, `/inspirations`, `/ai-presets`.
- APIs: `/api/ai/agent`, `/api/ai/agent/actions`, `/api/ai/conversations`, `/api/ai/conversations/[id]`, `/api/ai/generate`, `/api/ai/render`, `/api/ai/advice`, `/api/ai/soft-furnishing/render`, `/api/ai/history`, `/api/ai/status/[id]`, `/api/ai/usage`, `/api/ai/quota`, `/api/ai/presets`, `/api/ai/presets/[id]`, `/api/ai/workflows`, `/api/ai/workflows/[id]`, `/api/ai/workflows/[id]/run-stage`, `/api/ai/workflows/[id]/source-image`, `/api/ai/workflow-leads`, `/api/ai/assets/[id]/image`, `/api/ai/generations/[id]/image`, `/api/ai/image-proxy`, `/api/inspirations`.
- Models/libs: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`, `AiQuota`, `EnterpriseAiUsageSnapshot`, `MediaAsset`, `Inspiration`, `ai/*`, `gemini.ts`, `dxf.ts`.
- Responsibilities: AI assistant chat, design scenario workflows, floor plan labeling/rendering, style rendering, soft-furnishing rendering, prompt/preset configuration, generation history, usage/quota checks, media asset persistence, and inspiration library.

### 11. Mini Program Support APIs

- APIs: `/api/auth/miniprogram`, `/api/miniprogram/home`, `/api/miniprogram/mine`, `/api/location/reverse`, `/api/branding/[id]`.
- Models/libs: `User`, `AdminUser`, `Enterprise`, `FloorPlan`, `Lead`, `Measurement`, `CommissionRecord`, `EnterpriseOrder`, `PromotionEnterpriseRecord`.
- Responsibilities: mini program identity context, home dashboard data, mine/profile data, reverse geocoding, branding lookup, and cross-client business data access.

### 12. Automation, Notifications, and Reminders

- APIs: `/api/automation/reminders/run`, `/api/workflow-notification-logs`, `/api/workflow-notification-logs/poll`.
- Models/libs: `WorkflowNotificationLog`, `workflow-automation.ts`, `wechat-notification.ts`, `enterprise-wecom.ts`, `wecom.ts`, `useBrowserNotification.ts`.
- Responsibilities: scheduled reminder execution, notification dedupe, browser notification polling, mini program/WeChat notifications, and enterprise WeCom integration.

### 13. Diagnostics, Seeding, and Deployment Support

- APIs: `/api/health`, `/api/debug`, `/api/debug/tenant-context`, `/api/internal/seed`.
- Tooling: `admin/scripts/seed-admin.js`, `seed-inspirations.ts`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `release.sh`.
- Responsibilities: health checks, tenant-context debugging, seed data, Docker deployment, and release packaging.

## Core Data Models

- Identity and permissions: `AdminUser`, `SystemRole`, `User`, `Department`.
- Tenant and commercial operations: `Enterprise`, `Package`, `EnterpriseOrder`, `CommissionRecord`, `PromotionEnterpriseRecord`.
- Customer assets: `Lead`, `FloorPlan`, `Measurement`, `Device`, `Inspiration`.
- AI system: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`, `AiQuota`, `EnterpriseAiUsageSnapshot`, `MediaAsset`.
- Notifications: `WorkflowNotificationLog`, `PlatformConfig`.

## Maintenance Notes

- When adding a page under `admin/src/app/(admin)`, check sidebar permissions in `Sidebar.tsx`, route guards in `proxy.ts`, and default role permissions in `AdminUser.ts`.
- When adding an API route with tenant data, prefer `withTenantRoute` or `withTenantContext`, and verify the related model uses `multiTenantPlugin` when appropriate.
- User-visible admin mutations should use the shared operation feedback UI instead of raw `alert()`.
- When extending AI workflows, update the page route, API route, `AiGeneration`/`AiWorkflow` model types, preset definitions, and this document pair.
- When changing B2B promotion workflow statuses or SLA behavior, update `PromotionEnterpriseRecord`, workflow helpers, notification logs, workbench APIs, and this document pair.
