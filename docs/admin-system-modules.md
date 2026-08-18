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
| Packages, orders, commissions | `/packages`, `/orders`, `/commissions`, `/lead-commissions` | Package, order, existing commission, and `LeadCommissionRepository`; `GET/PUT /api/commission-rules`, filtered `GET /api/lead-commissions`, `POST /api/lead-commissions/mark-paid`. The workbench maintains all three rules and shows customer, referrer membership, enterprise, designer, measurer, and current confirmed appointment per report record | `lead-commissions` is available to `super_admin`, `admin`, and `enterprise_admin`; rule changes and offline batch paid marking use RLS and tenant transactions; Implemented/Limited | The separate three-role workbench does not change the legacy acquisition-commission route. Payment settlement remains outside this system; a live authenticated visual check still needs the current workspace runtime rather than the stale Docker image on port 3005 |
| Leads and conversion | `/leads`, `/leads/[id]` | Lead, legacy acquisition, lifecycle, floor-plan, `ReferralLeadRepository`, `CustomerProjectRepository`, and `LeadCommissionRepository`; the new flow atomically writes customer attribution, referrer membership, designer/measurer assignment and events, releases active attribution on closure, snapshots three role commissions during referral-network signing, and exposes AI generations to customers only through publication facts | Customer authorization or tenant/assigned-staff checks; an assigned designer may manage succeeded generations only for their own leads, while an enterprise administrator may manage the tenant; only an enterprise administrator can revert signing, and paid commissions block reversion; Implemented/Limited | The customer project renders the protected aggregate's real service facts, completed formal-plan summary, and explicitly published designs; publication images remain owner-only and are fetched into app-local temporary files. There is no customer graph-editing or measurement-editor entry. Legacy acquisition remains until phase 8 and legacy leads without all new beneficiaries retain their existing conversion behavior; leads with contracts or derived records cannot be purged |
| Formal floor plans | `/floorplans`, `/floorplans/[id]`, `/floorplans/kujiale` | `FloorPlanRepository`, surveying adapters, DXF exporter | Tenant and floor-plan permissions; Implemented | KuJiale provider capability is Limited |
| Measurements and BLE devices | `/measurements`, `/devices` | Measurement, device, binding, and audit repositories | Platform/enterprise assignment boundaries; Implemented | Device protocol support is limited to the documented meter |
| AI studio and generation | AI workflow, asset, provider, pricing, and credit pages | PostgreSQL AI repositories and provider adapters | Platform plus tenant AI permissions; Implemented/Limited | Provider availability and image storage are external |
| Media storage | `/media-storage` | `media_assets`, provider configuration, storage adapters | Platform admin; Implemented | Bucket cleanup is a separate operation |
| Mini Program support APIs | Admin diagnostics and shared API handlers; production anonymous claim routes are in the Mini Program | Identity/context and dual-code/referrer APIs; `/api/miniprogram/codes/resolve` issues a ten-minute pending source, `/api/miniprogram/referrer-memberships/[id]/promotion-code/image` returns a protected PNG generated by WeChat, and `/api/miniprogram/referrals/authorize-and-create-lead` atomically links the customer, locks attribution, creates the lead, and assigns staff; phase 5 provides appointment APIs; phase 6 provides customer-project aggregation, owner-only published-design images, and designer/enterprise-admin publication or withdrawal | Promotion resolution and code-image delivery are anonymous to the customer but membership-scoped for the referrer. Customer projects validate `customer_user_id` and never trust client enterprise context; appointment APIs are isolated by customer ownership, responsible designer, assigned measurer, or enterprise owner and use tenant transactions; `/api/miniprogram/notification-template` supplies authenticated identities with the configuration needed for customer subscription consent; Implemented/Limited | The customer project uses the completed-plan summary plus protected published-design images, not an editable graph or measurement editor. Appointment create, reschedule, and cancel attempt staff and authorized-customer delivery after commit; WeChat code generation, authorization, and notifications depend on external configuration |
| Notifications, automation, diagnostics | Notification settings, reminder runtime, diagnostics | Notification templates, scheduler, operational records | Platform/enterprise roles; Implemented/Limited | Subscription delivery can be rejected by WeChat |

## Formal surveying boundary

The authoritative contract is
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md).
`FloorPlan.layoutData` contains only `version: 4`,
`measurementMode: 'surveying'`, and `surveyGraph`. Measurements are immutable
audits; dimensions and room summaries are derived read models.

## Acquisition and commission boundary

The current measurer-designer legacy-flow contract is
[`measurer-designer-acquisition.md`](./measurer-designer-acquisition.md).
It defines bindings, acquisition confirmation, notifications, old commission
records, idempotency, and role boundaries. Referral-network signing commissions
are governed by this inventory and the development plan; their separate Admin
workbench is implemented from its approved Phase-7 design source.

## Maintenance

When a route, API, model, permission, status, or limitation changes, update the
affected row and its Chinese mirror. Keep one current description per module;
do not record the sequence of edits or paste test transcripts into this file.

Chinese mirror: [admin-system-modules.zh-CN.md](./admin-system-modules.zh-CN.md)
