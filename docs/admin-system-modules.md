# Admin System: Current Module Inventory

This is the current Admin runtime inventory. It records stable entry points,
contracts, permissions, and limitations only. Implementation history belongs in
Git commits; do not append dated change logs here.

## Shared architecture

- Next.js 16 App Router, React 19, Tailwind CSS 4, Ant Design 5, and Ant Design Pro.
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
| Staff, accounts, and appointment operations | `/staff`, `/departments`, `/users`, `/referrer-network-operations`, `/appointment-settings` | Staff, department, shared notification, admin-user, and appointment repositories. The appointment-settings page reads and updates timezone, weekly availability, default duration, slot step, booking horizon, and customer reschedule cutoff through `GET/PUT /api/appointment-settings`; an auto-created default row is explicitly distinguished from an administrator-confirmed policy. The operations workbench reads join-code audit, active referrer memberships, assignment eligibility, confirmed appointment settings, commission rules, and WeChat-code configuration through `GET /api/enterprise/referrer-network-readiness`, and each acceptance item links to its operating surface. `GET /api/enterprise/join-codes` remains token-free; the audited image endpoint generates a private, no-store onboarding image and preserves WeChat's PNG/JPEG media type. Both enterprise onboarding and referrer promotion images use `getwxacodeunlimit` with `env_version: develop`, including when the server process runs in production mode | `referrer-network-operations`, `/appointment-settings`, and their APIs reuse the `referrer-network-operations` permission and are fixed to `super_admin`, `admin`, and `enterprise_admin` in the selected tenant. Onboarding tokens remain type-isolated and staff can belong to only one enterprise; Implemented/Limited | The workbench does not create test business records or bypass Mini Program phone authorization. External WeChat credentials are diagnosed but not configured by this page. Authenticated Admin visual QA is complete at `http://localhost:3006` |
| Promotion and collaboration | `/promotions`, enterprise collaboration pages | Promotion, referral, and shared notification repositories | Enterprise and staff role boundaries; Implemented | WeCom delivery is optional and external |
| Packages, orders, commissions | `/packages`, `/orders`, `/commissions`, `/lead-commissions` | Package, order, existing commission, and `LeadCommissionRepository`; `GET/PUT /api/commission-rules`, filtered `GET /api/lead-commissions`, `POST /api/lead-commissions/mark-paid`. The workbench maintains all three rules and shows customer, referrer membership, enterprise, designer, measurer, and current confirmed appointment per report record | `lead-commissions` is available to `super_admin`, `admin`, and `enterprise_admin`; system administrators always expose the protected entry even when an older stored menu snapshot lacks the new key; rule changes and offline batch paid marking use RLS and tenant transactions; Implemented/Limited | The old acquisition-commission route is retired. Payment settlement remains outside this system |
| Leads and conversion | `/leads`, `/leads/[id]` | Lead lifecycle, floor-plan, `ReferralLeadRepository`, `CustomerProjectRepository`, and `LeadCommissionRepository`; the new flow atomically writes customer attribution, referrer membership, designer/measurer assignment and events, releases active attribution on closure, snapshots three role commissions during referral-network signing, and exposes AI generations to customers only through publication facts | Customer authorization or tenant/assigned-staff checks; an assigned designer may manage succeeded generations only for their own leads, while an enterprise administrator may manage the tenant; only an enterprise administrator can revert signing, and paid commissions block reversion; Implemented/Limited | The customer project renders the protected aggregate's real service facts, completed formal-plan summary, and explicitly published designs; publication images remain owner-only and are fetched into app-local temporary files. There is no customer graph-editing or measurement-editor entry; leads with contracts or derived records cannot be purged |
| Formal floor plans | `/floorplans`, `/floorplans/[id]`, `/floorplans/kujiale` | `FloorPlanRepository`, surveying adapters, DXF exporter | Tenant and floor-plan permissions; Implemented | KuJiale provider capability is Limited |
| Measurements and BLE devices | `/measurements`, `/devices` | Measurement, device, binding, and audit repositories | Platform/enterprise assignment boundaries; Implemented | Device protocol support is limited to the documented meter |
| AI studio and generation | AI workflow, asset, provider, pricing, and credit pages | PostgreSQL AI repositories and provider adapters | Platform plus tenant AI permissions; Implemented/Limited | Provider availability and image storage are external |
| Media storage | `/media-storage`; `npm run db:backup`, `npm run db:restore-drill`, `npm run db:cleanup:dry-run`, and `npm run db:cleanup:execute` | `media_assets`, provider configuration, storage adapters; backup emits a custom PostgreSQL dump and duration, the restore drill uses only `smart_floor_planner_restore_drill` and verifies the current app schema before removing that drill database, the cleanup dry-run sets its read-only session to the existing platform scope before it fingerprints the target and emits a Qiniu candidate manifest, and the execute command requires an exact fingerprint, approved manifest SHA-256, explicit local-production switch, and operator identity before its one-transaction database cleanup and audit output | Platform admin; Implemented/Limited | Qiniu object deletion remains a separately approved asynchronous operation after a nonempty human-approved manifest; the execute command does not call Qiniu |
| Mini Program support APIs | Admin diagnostics and shared API handlers; production anonymous claim routes are in the Mini Program | Identity/context and dual-code/referrer APIs; `/api/miniprogram/codes/resolve` returns an onboarding code's type and target enterprise display name before phone authorization, or issues a ten-minute pending source for referral codes. `/api/miniprogram/referrer-memberships/[id]/promotion-code/image` returns a protected PNG/JPEG generated by WeChat, and `/api/miniprogram/referrals/authorize-and-create-lead` atomically links the customer, locks attribution, creates the lead, and assigns staff; phase 5 provides appointment APIs; phase 6 provides customer-project aggregation, owner-only published-design images, and designer/enterprise-admin publication or withdrawal | Promotion resolution and code-image delivery are anonymous to the customer but membership-scoped for the referrer. Customer projects validate `customer_user_id` and never trust client enterprise context; appointment APIs are isolated by customer ownership, responsible designer, assigned measurer, or enterprise owner and use tenant transactions; `/api/miniprogram/notification-template` supplies authenticated identities with the configuration needed for customer subscription consent; Implemented/Limited | The customer project uses the completed-plan summary plus protected published-design images, not an editable graph or measurement editor. Appointment create, reschedule, and cancel attempt staff and authorized-customer delivery after commit; WeChat code generation, authorization, and notifications depend on external configuration |
| Notifications, automation, diagnostics | Notification settings, reminder runtime, diagnostics | Notification templates, scheduler, operational records | Platform/enterprise roles; Implemented/Limited | Subscription delivery can be rejected by WeChat |

## Formal surveying boundary

The authoritative contract is
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md).
`FloorPlan.layoutData` contains only `version: 4`,
`measurementMode: 'surveying'`, and `surveyGraph`. Measurements are immutable
audits; dimensions and room summaries are derived read models.

## Commission boundary

The measurer-designer acquisition contract is retired and retained only as a
record in [`measurer-designer-acquisition.md`](./measurer-designer-acquisition.md).
Referral-network signing commissions are governed by this inventory and the
development plan; their separate Admin workbench is implemented from its
approved Phase-7 design source.

## Maintenance

When a route, API, model, permission, status, or limitation changes, update the
affected row and its Chinese mirror. Keep one current description per module;
do not record the sequence of edits or paste test transcripts into this file.

Chinese mirror: [admin-system-modules.zh-CN.md](./admin-system-modules.zh-CN.md)
