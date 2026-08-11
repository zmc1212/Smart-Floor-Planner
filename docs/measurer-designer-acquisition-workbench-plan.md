# Measurer–Designer Dual-Track Acquisition Workbench Implementation Plan

Status: `Implemented`

Approved: 2026-08-10

Implemented: 2026-08-10

UI refinement approved: 2026-08-10 (Leads designer entry, shared designer contact sheet, lead-detail formal-surveying information hierarchy, and the single measurer-workbench designer entry)

This document records the implemented dual-track design: remove `acquired` from the lead lifecycle, derive acquisition confirmation independently, and add a role-aware Acquisition Collaboration workbench.

Current runtime behavior, data contracts, and limitations remain authoritative in the code, `docs/measurer-designer-acquisition.md`, and both module-inventory language pairs; this document remains the approved implementation and acceptance reference.

## 1. Problem

The current rail—`new -> acquired -> measuring -> designing -> converted`—incorrectly implies that acquisition confirmation is required before surveying. In reality:

- Lead status represents business delivery progress.
- Acquisition confirmation records whether the measurer completed the customer-to-designer WeChat handoff.
- Confirmation generates a measurer commission but must not block surveying, design, or conversion.

## 2. Approved three-dimensional model

| Dimension | States | Purpose |
| --- | --- | --- |
| Lead lifecycle | `new -> measuring -> designing -> converted`; terminal `closed` | Customer business progress |
| Acquisition confirmation | `pending_confirmation` / `confirmed` | Measurer handoff completion |
| Commission settlement | `pending_settlement -> paid`; exceptional `voided` | Commission generation and payment |

Acquisition confirmation should be derived from existing audit data:

```ts
const acquisitionStatus = acquiredAt ? 'confirmed' : 'pending_confirmation';
```

The database source remains `acquired_at` and `acquired_by`; a persisted acquisition-status column is not required for the first implementation.

## 3. Business rules

- A new lead can begin surveying without acquisition confirmation.
- `acquired` is no longer written to `leads.status`.
- The assigned designer can confirm during `new`, `measuring`, `designing`, or `converted`.
- An unconfirmed `closed` lead cannot be confirmed by an ordinary designer; future administrator correction handles exceptions.
- Confirmation writes `acquired_at/acquired_by`, creates one pending acquisition commission, and does not mutate lead lifecycle status.
- A later lead closure does not automatically cancel an already-earned commission.
- Unique constraints and conditional updates continue to prevent duplicate confirmation, notifications, and commissions.

## 4. Information architecture

### Lead management

The lead page remains a pure business-progress surface. Remove the `acquired` filter, lifecycle step, card status, and copy that implies acquisition is required before surveying.

The canonical display becomes:

```text
New lead -> Measuring -> Design proposal -> Signed
                                  -> Closed
```

#### Approved Leads-page design lock

`pages/leads-management/leads-management` must preserve the approved C-direction customer-dossier composition and this first-screen order:

```text
Native WeChat capsule safe area
-> Leads title and Xiao K customer-concierge scene
-> Green dossier summary
-> Search / Filter / Add customer
-> Business-stage index
-> Customer dossier cards
```

- Never insert a full bound-designer profile card, WeChat ID, or large QR code between the title and green dossier summary. Secondary contact information must not disrupt the approved first-screen rhythm.
- For a measurer with an authorized `designerProfile`, show one lightweight `我的设计师` entry on the right side of the safe content lane below the native capsule. It must not overlap the capsule, title, Xiao K scene, dossier summary, or high-frequency search controls.
- The entry is a contextual utility, not a primary button, statistic card, floating action, full-width banner, or second strong-green region.
- Designers, ordinary users, and roles without authorized designer data do not see the entry or a placeholder QR/profile.
- The local interaction reference is `design-references/lead-designer-contact-sheet-v1.png`. It illustrates entry, sheet, and cross-page reuse only; this written contract, current code, permissions, and real data override its sample content.

### Acquisition Collaboration workbench

Do not add a bottom tab. Add a role-aware workbench entry under Mine and use notifications as contextual deep links.

Suggested route:

```text
/packages/business/acquisition-center/acquisition-center
```

Suggested notification deep link:

```text
/packages/business/acquisition-center/acquisition-center?leadId=<leadId>
```

### Shared designer contact sheet

Add one main-package shared component at the suggested path:

```text
/components/designer-contact-sheet/designer-contact-sheet
```

The main-package Leads page and `packages/business` pages must call the same component instead of implementing separate QR cards or dialogs. Entry copy changes with context while sheet content and behavior remain consistent:

| Caller | Entry copy | Purpose |
| --- | --- | --- |
| Leads page | `我的设计师` | View the measurer's current bound designer |
| Lead-detail Acquisition Collaboration group | `联系设计师` | View the designer captured for that lead |
| Measurer Acquisition Collaboration page | `我的设计师` / `查看微信` | View the measurer's one current bound designer once between the summary and task segments |

- Use a modal bottom sheet titled `设计师名片`, entering from the bottom and respecting the bottom safe area; do not use a centered desktop-style dialog.
- Show only authorized real data: designer name, role label, WeChat ID, signed QR image, compact copy affordance, long-press helper, and a clear close path.
- `复制微信号` is the only emphasized action. Missing WeChat/QR data, expired signed URLs, loading, failure, and retry require truthful states; never render a fake QR image or empty oversized card.
- The sheet is read/copy-only. It must not bind, rebind, or edit the relationship, and its title must not imply that the current user can mutate binding.
- Preserve scrim-tap dismissal, an explicit close button, touch/type floors, and QR long-press recognition. Opening or closing the sheet must not mutate filters, scroll position, lead status, or acquisition state.
- Leads and the measurer Acquisition Collaboration page use the current page-level `designerProfile`. Collaboration task cards must not repeat WeChat IDs, QR data, or designer-contact actions. Lead detail continues to use the designer snapshot attached at lead creation; later rebinding must not mix these sources.

## 5. Designer experience

- Header: `获客协作` / “Confirm customer WeChat handoff”.
- Summary: pending confirmations and current-month completed count.
- Segments: Pending / Completed.
- Task card shows customer, masked phone, measurer, submission time, lead-detail link, and one primary action.
- Primary action: `确认已添加微信`.
- Confirmation copy explains that the action completes the measurer handoff and generates a pending commission without changing lead progress.
- Completed tasks show confirmation time and measurer details.

## 6. Measurer experience

- Summary: pending confirmation, completed count, and pending-settlement amount.
- Segments: Waiting / Completed.
- One page-level `My Designer / View WeChat` utility follows the summary and serves every waiting/completed task because a measurer has one current binding.
- Waiting cards show the lead, waiting explanation, and lead-detail entry without repeated designer data or contact actions.
- Completed cards become handoff receipts with confirmation time, amount, and settlement status; the historical designer fact remains available in server data and lead detail.
- Full finance details remain in the existing commission page.

## 7. Lead detail

Do not add a second timeline. Add one normal information section:

```text
Acquisition collaboration
Designer: Zhang
WeChat handoff: Confirmed
Confirmed at: 2026-08-10 14:32
Contact designer >
View collaboration record >
```

Confirmation is owned by the Acquisition Collaboration workbench; lead detail links to it rather than implementing a second confirmation rule.

- `联系设计师` is visible only to a measurer authorized to read that designer's WeChat profile and opens the shared sheet defined above. Lead detail must not implement another QR card.
- The detail hero remains limited to customer identity and business status. Designer contact belongs in the normal Acquisition Collaboration information group and must not compete with the formal-surveying primary action.

### Formal-surveying card hierarchy

`whole-home-tab` is the formal-surveying card's sole section title. Do not render `whole-home-plan-name`, an auto-generated “Formal Survey 1” label, or a full timestamp as a second title.

Keep three information levels only:

1. Section title: `正式量房`.
2. Primary task: `下一步` plus the truthful current `nextAction`.
3. Supporting metadata:
   - No formal plan: `从墙图开始建立客户户型`.
   - In progress: `量房中 · <closed-space count>个空间 · <M月D日>更新`.
   - Completed: `已完成 · <closed-space count>个空间 · <M月D日>更新`.

Space count and update date must come from the current formal version-4 plan. Omit a missing count or invalid date segment instead of inserting a placeholder. Existing continue/start/new/delete behavior and permissions remain unchanged.

## 8. Visual direction

- Mode: `Operate`.
- Xiao K role: handoff witness.
- Business metaphor: customer-file handoff and confirmation receipt.
- Use Xiao K once in the header or empty state, never as repeated card decoration.
- Continue the bright-green, soft-white system and the licensed local icon family.
- Reserve the native WeChat capsule at `390x844`.
- Primary text/actions remain at least `24rpx`; helper metadata remains at least `20rpx`.

## 9. API and data changes

### `POST /api/leads/[id]/acquire`

- Stop requiring `lead.status === 'new'`.
- Conditionally update by assigned designer, `acquired_at IS NULL`, and supported non-closed lifecycle state.
- Write only `acquired_at`, `acquired_by`, and `updated_at`; never write `status = 'acquired'`.
- Create the unique pending commission and in-app notification in the same transaction.
- Send WeChat after commit; delivery failure does not roll back business data.

### New task query

Suggested API:

```text
GET /api/acquisition-tasks
```

It should:

- Return role-shaped tasks for the authenticated Mini Program staff member.
- Restrict designers to assigned leads and measurers to promoted leads.
- Support pending/confirmed filters, pagination, and time filters.
- Return truthful role-specific summaries.
- Use shared tenant helpers, staff context, PostgreSQL transactions, and RLS.

### DTO

```ts
{
  status: 'measuring',
  acquisitionStatus: 'confirmed',
  acquiredAt: '2026-08-10T06:32:00.000Z',
  acquiredBy: '...',
  acquisitionCommissionStatus: 'pending_settlement'
}
```

## 10. Migration

1. For `status = 'acquired'` with `acquired_at`, preserve acquisition audit and restore lifecycle status to `new`.
2. Preserve `measuring`, `designing`, or `converted` for progressed records with `acquired_at`.
3. Report, but do not silently invent a timestamp for, commission records whose lead lacks `acquired_at`.
4. Remove `acquired` from current client/admin lifecycle dictionaries and filters.
5. Reject historical direct `status = 'acquired'` writes or translate them only through an explicit compatibility confirmation path.

The migration must be idempotent and run with the migrator role; do not grant schema migration authority to `sfp_app`.

## 11. Future statistics

Prepare truthful facts for:

- Submitted leads, confirmed acquisition, pending confirmation, and aging.
- Confirmation rate and average confirmation time.
- Pending and paid commission amounts.
- Enterprise, measurer, designer, and date groupings.

Keep two date semantics separate:

- Period confirmation count uses `acquired_at`.
- Submission-cohort acquisition rate uses `created_at` and final confirmation outcome.

Phone de-duplication affects attribution. Do not create a second commission for a duplicate submission until ownership rules are explicitly approved.

## 12. State matrix

| State | Designer | Measurer |
| --- | --- | --- |
| Loading | Skeleton, no fake counts | Skeleton, no fake amount |
| Pending | Confirmation primary action | One page-level bound designer entry; waiting explanation inside each task |
| Confirmed | Confirmation receipt | Receipt and commission summary |
| Empty | No pending handoffs | No collaboration records |
| Failure | Retry without losing structure | Retry without losing structure |
| Duplicate confirmation | Refresh to completed | Show latest receipt |
| Unauthorized/history | Read-only or explicit refusal | Preserve creation-time designer snapshot |

## 13. Expected implementation scope

- Lead acquire/list APIs and DTOs.
- Acquisition repository and new task API.
- A new Drizzle migration.
- Admin lead status dictionaries and filters.
- Mini Program lead list/detail, Mine workbench, notifications, route registration, and new acquisition-center package.
- Shared `miniprogram/components/designer-contact-sheet/` used by Leads, lead detail, and the measurer workbench.
- PostgreSQL integration tests and Mini Program model/UI contract tests.
- Focused acquisition contract and both Admin/Mini Program module-inventory language pairs.

## 14. Lead archive compatibility

The acquisition workbench must treat archived leads as historical assets, not
active tasks: archive-aware lead queries default to active, archived rows are
hidden from acquisition task lists and customer selectors, and confirmation or
new acquisition work returns `409 LEAD_ARCHIVED`. Existing settled and pending
commission records remain readable/settleable. Phone de-duplication must return
`409 ARCHIVED_LEAD_EXISTS` for an archived match. Archive/purge permissions and
the row-level designer/measurer boundaries are resolved live from enterprise
role defaults plus employee overrides; purge remains manager-only and never
force-cascades protected assets.

## 15. Acceptance criteria

- Acquisition confirmation never changes lead lifecycle status.
- Surveying does not depend on acquisition confirmation.
- `new`, `measuring`, `designing`, and `converted` can be confirmed once.
- Tenant, designer, and measurer access remains isolated.
- Historical `acquired` records preserve audit and commissions after migration.
- Lead management no longer presents `acquired` as a lifecycle state.
- Lead management no longer places a full designer profile card above its core content; the approved title, Xiao K scene, dossier summary, search actions, stage index, and lead-card order remain intact.
- Leads and the measurer workbench each expose one page-level `My Designer` entry; lead detail retains `Contact designer`. All use the same bottom sheet, while task cards expose no repeated contact action and current-binding data remains distinct from historical lead snapshots.
- Mine exposes a role-aware Acquisition Collaboration entry with real counts.
- Notifications deep-link to the exact collaboration task.
- The new workbench covers loading, pending, completed, empty, error, retry, and duplicate states.
- Lead detail does not render the duplicate `whole-home-plan-name`; its formal-surveying card uses the truthful supporting copy and metadata defined above.
- The `390x844` baseline preserves the native capsule and typography/touch floors.

## 15. Verification

```powershell
cd admin
npm run lint
npm run build
npm run test:postgresql

cd ..\miniprogram
npm test

cd ..
git diff --check
```

## 16. Non-goals

- No automatic payout or bank integration.
- No new bottom tab.
- No full acquisition-statistics admin page in this phase.
- No new attribution rule for duplicate-phone submissions.
- No change to existing order-commission semantics.
