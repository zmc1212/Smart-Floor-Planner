# Admin System: Current Module Inventory

This is the current Admin runtime inventory. It records stable entry points,
contracts, permissions, and limitations only. Implementation history belongs in
Git commits; do not append dated change logs here.

## Shared architecture

- Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui/Radix.
- PostgreSQL 17 with `drizzle-orm`/`pg` is the deployed runtime. Tenant-aware
  reads and writes use repositories, transactions, and RLS.
- Admin sessions use cookie/JWT authentication. Platform and enterprise roles
  are enforced by route guards and menu permissions.
- External provider and object-storage I/O runs outside short database
  transactions. API handlers serialize `bigint` values through DTOs.
- Formal floor plans are version-4 surveying graphs. Viewers, DXF, 3D, and AI
  consume derived read models and never write legacy layout fields.

## Status legend

`Implemented` means a real page/API/data path exists. `Limited` means a defined
role, provider, source shape, or operational condition restricts it.
`Placeholder` means UI or a mock path exists without the promised persistence or
integration.

## Module inventory

| Module | Current entry points | API/data boundary | Permission/status | Current limitation |
| --- | --- | --- | --- | --- |
| Authentication and sessions | `/login`, `/register`; auth middleware | `/api/auth/*`; Mini Program JWTs use base user `sub`, selected `customer/staff/referrer` context, and `contextVersion` | Public entry plus authenticated routes; Implemented | WeChat provider configuration remains environment-dependent; legacy identity columns coexist until the old acquisition flow is retired |
| Navigation, roles, access | Shared sidebar and route guards | `/api/permissions`, role/menu repositories | `super_admin`, `admin`, enterprise roles; Implemented | Effective permissions are tenant and role scoped |
| Platform and enterprises | `/dashboard`, `/enterprises` | Enterprise, branding, activation, and platform repositories | Platform roles; Implemented | Enterprise context is required for tenant mutations |
| Staff and accounts | `/staff`, `/departments`, `/users` | Staff, department, binding, and admin-user repositories | Platform/enterprise admin boundaries; Implemented | Staff changes can invalidate role-derived visibility |
| Promotion and collaboration | `/promotions`, enterprise collaboration pages | Promotion, referral, notification, and acquisition repositories | Enterprise and staff role boundaries; Implemented | WeCom delivery is optional and external |
| Packages, orders, commissions | `/packages`, `/orders`, `/commissions` | Package, order, commission repositories | Platform/enterprise boundaries; Implemented | Payment settlement is outside this system |
| Leads and conversion | `/leads`, `/leads/[id]` | Lead, acquisition, lifecycle-event, floor-plan repositories | Tenant and assigned-staff checks; Implemented | Purge is blocked when contractual or derived records exist |
| Formal floor plans | `/floorplans`, `/floorplans/[id]`, `/floorplans/kujiale` | `FloorPlanRepository`, surveying adapters, DXF exporter | Tenant and floor-plan permissions; Implemented | KuJiale provider capability is Limited |
| Measurements and BLE devices | `/measurements`, `/devices` | Measurement, device, binding, and audit repositories | Platform/enterprise assignment boundaries; Implemented | Device protocol support is limited to the documented meter |
| AI studio and generation | AI workflow, asset, provider, pricing, and credit pages | PostgreSQL AI repositories and provider adapters | Platform plus tenant AI permissions; Implemented/Limited | Provider availability and image storage are external |
| Media storage | `/media-storage` | `media_assets`, provider configuration, storage adapters | Platform admin; Implemented | Bucket cleanup is a separate operation |
| Mini Program support APIs | Admin diagnostics and shared API handlers | `/api/auth/miniprogram`, `/api/miniprogram/identity-contexts`, `/api/miniprogram/identity-contexts/switch`; leads, floor plans, AI, notifications | Ordinary customers and validated staff/referrer contexts; Implemented | Referrer membership creation and the redesigned business loop remain planned for later phases |
| Notifications, automation, diagnostics | Notification settings, reminder runtime, diagnostics | Notification templates, scheduler, operational records | Platform/enterprise roles; Implemented/Limited | Subscription delivery can be rejected by WeChat |

## Formal surveying boundary

The authoritative contract is
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md).
`FloorPlan.layoutData` contains only `version: 4`,
`measurementMode: 'surveying'`, and `surveyGraph`. Measurements are immutable
audits; dimensions and room summaries are derived read models.

## Acquisition and commission boundary

The current measurer-designer contract is
[`measurer-designer-acquisition.md`](./measurer-designer-acquisition.md).
It defines bindings, lead acquisition confirmation, notifications, commission
records, idempotency, and role boundaries. The separate workbench plan is not a
runtime contract.

## Maintenance

When a route, API, model, permission, status, or limitation changes, update the
affected row and its Chinese mirror. Keep one current description per module;
do not record the sequence of edits or paste test transcripts into this file.

Chinese mirror: [admin-system-modules.zh-CN.md](./admin-system-modules.zh-CN.md)
