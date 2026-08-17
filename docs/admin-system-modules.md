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
| Staff and accounts | `/staff`, `/departments`, `/users`; no phase-3 dual-code UI | Staff, department, legacy binding, and admin-user repositories; dual-code APIs; designer/measurer `assignmentPaused` and profile completeness control new-flow assignment eligibility, while onboarding, creation, profile completion, or re-enable retries pending leads | Join-code management is limited to `super_admin`, `admin`, and `enterprise_admin`; onboarding tokens are type-isolated and staff can belong to only one enterprise; Implemented | Active join codes and pending sources require a stable production secret of at least 128 bits; production dual-code UI remains planned |
| Promotion and collaboration | `/promotions`, enterprise collaboration pages | Promotion, referral, notification, and acquisition repositories | Enterprise and staff role boundaries; Implemented | WeCom delivery is optional and external |
| Packages, orders, commissions | `/packages`, `/orders`, `/commissions` | Package, order, commission repositories | Platform/enterprise boundaries; Implemented | Payment settlement is outside this system |
| Leads and conversion | `/leads`, `/leads/[id]` | Lead, legacy acquisition, lifecycle, floor-plan, and `ReferralLeadRepository`; the new flow atomically writes customer attribution, referrer membership, designer/measurer assignment and events, and closing releases the active attribution | Customer authorization or tenant/assigned-staff checks; Implemented | Anonymous claim UI is live, while the internal referrer workbench remains planned; the legacy acquisition flow coexists until phase 8; purge is blocked by contractual or derived records |
| Formal floor plans | `/floorplans`, `/floorplans/[id]`, `/floorplans/kujiale` | `FloorPlanRepository`, surveying adapters, DXF exporter | Tenant and floor-plan permissions; Implemented | KuJiale provider capability is Limited |
| Measurements and BLE devices | `/measurements`, `/devices` | Measurement, device, binding, and audit repositories | Platform/enterprise assignment boundaries; Implemented | Device protocol support is limited to the documented meter |
| AI studio and generation | AI workflow, asset, provider, pricing, and credit pages | PostgreSQL AI repositories and provider adapters | Platform plus tenant AI permissions; Implemented/Limited | Provider availability and image storage are external |
| Media storage | `/media-storage` | `media_assets`, provider configuration, storage adapters | Platform admin; Implemented | Bucket cleanup is a separate operation |
| Mini Program support APIs | Admin diagnostics and shared API handlers; production anonymous claim routes are in the Mini Program | Identity/context and dual-code/referrer APIs; `/api/miniprogram/codes/resolve` issues a ten-minute pending source, `/api/miniprogram/referrer-memberships/[id]/promotion-code/image` returns a protected PNG generated by WeChat, `/api/miniprogram/referrals/authorize-and-create-lead` atomically links the customer, locks attribution, creates the lead, and assigns staff; service identity can call `/api/internal/lead-assignments/[leadId]/retry` | Promotion resolution and code-image delivery are anonymous to the customer but membership-scoped for the referrer; lead creation requires direct WeChat phone authorization plus `Idempotency-Key`; internal retry requires an `INTERNAL_SECRET` of at least 32 characters; Implemented/Limited | WeChat code generation, authorization, and notification depend on external configuration; the internal referrer workbench remains planned |
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
