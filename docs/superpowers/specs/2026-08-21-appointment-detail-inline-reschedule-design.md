# Appointment Detail — Inline Reschedule (Align Design 03)

**Date:** 2026-08-21  
**Status:** Implemented / ready for QA  
**Surface:** Mini Program · `packages/business/appointment-detail/appointment-detail`  
**Visual source:** `design-references/miniprogram-airy-minimalist-v1/03-appointment-reschedule.jpg`  
**Related route:** `packages/business/appointment-reschedule/appointment-reschedule` (compat redirect shell)

## Problem

The staff-facing appointment detail stacks multiple equal-weight green CTAs (start survey, confirm reschedule, cancel) plus address / community-sync / navigation actions. That diverges from approved design `03`, which is a single composition: hero → current appointment card → in-page date/slot picker → fixed cancel + confirm reschedule bar. Reschedule today lives on a separate route, so customers take an extra hop.

## Goals

- Align `appointment-detail` with design `03` (capsule-safe `390x844`).
- Embed real availability date/slot selection on the detail page when `canReschedule`.
- Customer mode follows `03` for composition and picker; **exception:** omit cancel when the role lacks `canCancel` (do not show a disabled cancel). Confirm then becomes full-width.
- Staff keeps survey / address / navigate / sync capabilities in a secondary scroll region, without dual primary green buttons in the sticky footer.
- Keep the existing permission matrix and appointment APIs unchanged.

## Non-goals

- Redesigning `35-appointment-action-states` lifecycle tracking.
- Changing first-time booking (`appointment-booking`).
- Expanding who may cancel, reschedule, start survey, or complete.
- Inventing new dispatch or assignment controls.
- Removing the `appointment-reschedule` path from `app.json` (keep as deep-link shell).

## Locked decisions

| Decision | Choice |
| --- | --- |
| Scope | Align to design `03` |
| Reschedule UX | Merge into `appointment-detail` (in-page calendar) |
| Staff extras | Role-aware secondary region; do not interrupt in-page reschedule |
| Approach | Detail hosts shared slot picker; old reschedule route redirects |
| Customer vs `03` cancel | Visual exception: cancel only when `canCancel`; otherwise full-width confirm |
| Date window | Keep existing 5-day window + prev/next paging and `maxAdvanceDays` (not a static five days only) |

## Information architecture

Top → bottom on `appointment-detail`:

1. **Capsule-safe nav** — title「预约详情与改期」, back
2. **Green hero** — title, subtitle, status pill, Xiao K / schedule-guide asset
3. **Current appointment card** — date·time, address (+ optional map place name), staff row when present (measurer/designer; phone when available)
4. **「调整上门时段」** — only when `canReschedule`: horizontal 5-day window with existing prev/next paging, available slots, optional internal reason
5. **Safety points** — 全程免费量房 · 提交后自动同步服务人员
6. **Staff secondary actions** (staff only, in scroll content above the sticky bar) — start survey / complete, address ∥ navigate, sync community
7. **Sticky footer** — role- and state-aware primary controls (see Action hierarchy)

When reschedule is not allowed, hide block 4 and the confirm-reschedule CTA; show read-only copy or promote the staff work CTA as appropriate.

## Action hierarchy

Permissions stay as implemented today (customer vs designer / measurer / enterprise_admin). Presentation only:

### Customer (`mode=customer`)

- Reschedulable: in-page slots + sticky confirm with dynamic label「确认改期至{月日} {开始时分}」(from selected slot); disabled until a slot is selected. Cancel omitted (customers lack `canCancel`) → confirm is full-width.
- Not reschedulable: read-only detail + helper copy.
- Never show: start survey, complete, update address, sync community, navigate.

### Staff

- When `canReschedule`: same in-page picker as `03`; sticky bar layout:
  - `canCancel` + confirm → **side-by-side** like `03`: left outlined「取消本次预约」, right green confirm with the same dynamic date/time label; confirm disabled until a slot is selected
  - confirm only → full-width green confirm
- Internal reason field remains optional for `internal-reschedule`.
- Secondary region (not sticky primary):
  - Start survey **or** complete (existing mutual exclusion)
  - Update address ∥ one-tap navigate (outlined pair; calendar-style language)
  - Sync to customer community when eligible
- Measurer without reschedule: no block 4; sticky may promote start survey / complete as the single primary CTA.
- Expired + `canRebook`: no in-page reschedule; sticky「重新预约上门」→ booking.

### Conflict rule

When `canReschedule` is true, **reschedule always owns the sticky primary**. Start survey **and** complete (and any other staff work CTAs) stay in the secondary scroll region — including when `enterprise_admin` has both `canReschedule` and `canComplete` / `canStartSurvey`. The sticky bar must never show two equal green primaries.

### Detail must submit inline

`appointment-detail` must **not** `navigateTo` `appointment-reschedule`. Reschedule submit runs on the detail page against `customer-reschedule` / `internal-reschedule` using the **refreshed** `appointment.version` from the last detail load (not a stale query param).

### Success after inline submit

Stay on `appointment-detail`: toast success, call `load()`, clear selected slot / reason. Do **not** `navigateBack` (that was correct only for the old dedicated page).

## Components and compatibility

### Shared slot picker

Extract date-window, availability load/select, and optional reason from the current `appointment-reschedule` page into a shared helper (e.g. `utils/appointmentSlotPicker.js`) plus markup/styles hosted on the detail page (or a thin component). Reuse:

- `GET /appointments/availability?leadId=&date=`
- `POST /appointments/[id]/customer-reschedule` or `internal-reschedule` with `startAt`, `endAt`, `version`, and optional `reason`

Visual contract from `03`: five day cards in the current window, selected slot outline + check affordance, staff reason textarea. Retain prev/next window controls and `maxAdvanceDays` from today’s reschedule page.

### `appointment-reschedule` route (compat shell)

Remain registered. Become a **compat shell** that does not render a second full UI:

1. Existing deep links (service home, role workbench, customer project, identity nav) may still open the path.
2. `onLoad` immediately `redirectTo` `appointment-detail` with mapped query (below).
3. Success UX lives only on detail after redirect; the shell never submits.

### Mode / query mapping for the shell

| Incoming `appointment-reschedule` query | Redirect `appointment-detail` query |
| --- | --- |
| `mode=customer` or **absent** `mode` (legacy customer callers) | `mode=customer` |
| `mode=internal` | omit `mode` or pass staff context without `mode=customer` (detail treats only `mode=customer` as customer) |
| `leadId`, `appointmentId` | required; if missing, show toast and `navigateBack` / stay with error — do not open an empty detail |
| `version` | may be forwarded for redirect completeness only; detail ignores it for POST and always uses API-loaded `appointment.version` |

Staff deep links that today omit `mode` and would be mis-classified as customer **must** be updated in the same change to pass `mode=internal` **or** navigate directly to `appointment-detail` without `mode=customer`. Prefer direct detail navigation where practical.

## States and errors

| State | Behavior |
| --- | --- |
| Detail loading | Existing loading card |
| Slots loading | Picker-local「正在计算可用时段…」 |
| No slots that day | Keep date strip; empty-slot copy; confirm disabled |
| Version / slot conflict | Toast existing API message; refresh availability + detail version |
| Completed / cancelled | No picker; read-only card + finished note |
| No coordinates | Hide navigate; address edit still follows permission |
| Inline reschedule success | Toast; `load()`; clear slot selection; stay on detail |

No new APIs. No permission matrix changes.

## Acceptance

- Customer reschedulable state matches `03` at element level on `390x844` with WeChat capsule reserved, **except** cancel omitted and confirm full-width when `!canCancel`.
- Staff reschedulable + `canCancel`: side-by-side sticky cancel|confirm like `03`; secondary actions never sit as a second sticky primary beside confirm reschedule.
- Confirm label is dynamic from the selected slot; disabled until selected.
- Detail has zero outbound navigation to `appointment-reschedule` for the reschedule action.
- Focused tests updated (must include):
  - `appointment-detail-actions` — inline select + submit; no navigate-to-reschedule
  - `appointment-calendar` — shared picker / shell redirect (not a second full UI)
  - `customer-service-home`, `slice-5-role-homes` — callers either hit detail or shell with correct `mode`
  - Shell asserts redirect query completeness + mode mapping table
- Documentation (same change):
  - English/Chinese restoration ledgers for `appointment-detail` and `appointment-reschedule`
  - `docs/miniprogram-airy-minimalist-v1-page-inventory.zh-CN.md` only (no EN twin in repo): A03 = detail with inline reschedule; A04 = compat redirect shell — do not invent a full English page inventory in this change
  - Mini Program module inventory English/Chinese pair if routes/flows are listed there
- Authenticated native-capsule host capture may remain pending after functional land.

## Out of scope reminders

- Do not reintroduce dual sticky green primaries for survey/complete + reschedule.
- Do not change booking or measurer calendar pages in this change (except inbound links’ `mode` / target path as required for correct shell mapping).
