# Appointment Address → Customer Community Sync

**Date:** 2026-08-21  
**Status:** Implemented under recommended defaults from the original feature request (explicit sync, empty-only write, designer/enterprise owner)  
**Surfaces:** Mini Program `appointment-booking`, `appointment-detail`; Admin leads drawer address flow  
**Related API:** existing `PUT /api/leads/[id]` (`communityName`); appointment address remains on `POST /api/appointments` and `POST /api/appointments/[id]/address`

## Problem

Staff often enter the on-site measurement service address while booking or completing an appointment. That address is usually the customer’s community / unit, but today it only lives on `measurement_appointments.address`. The lead profile field `leads.communityName` stays empty unless someone opens「补充资料」and types it again.

Booking already pre-fills the appointment address from `communityName` when present; the reverse path is missing.

## Goals

- Let authorized staff copy a saved appointment service address into the lead’s `communityName` in one explicit action.
- Avoid silent overwrite of an existing community value.
- Reuse the current lead profile permission and `PUT /api/leads/[id]` contract; do not invent a parallel write path.
- Keep map coordinates (`locationName` / lat / lng) on the appointment only.

## Non-goals

- Auto-writing community on every appointment create/update.
- Letting the owning customer mutate `communityName` from booking.
- Syncing GCJ-02 map points into lead storage (no lead location columns today).
- Changing referrer privacy (referrers still never see precise addresses).

## Locked defaults (pending user override)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Trigger | Explicit control「同步到客户小区」after address is known | Controllable; matches “快捷” without silent mutation |
| Overwrite | Write only when `communityName` is empty; otherwise toast and no-op | Empty-profile fill is the common case; overwrite is riskier |
| Who | Same as「补充资料」: assigned designer, assigned measurer, or enterprise owner | Matches `PUT /api/leads/[id]` / Mini Program `canEditLeadProfile` |
| Payload | Full appointment `address` text → `communityName`, client `.trim().slice(0, 160)` | Appointment allows 300 chars; referral create path slices to 160; `LeadRepository.update` does not — client must slice |
| API | No new endpoint | YAGNI; one extra `PUT` from the client |
| Empty-only enforcement | Client guard: re-read lead (or use just-loaded community) immediately before PUT; skip if non-empty | No new server conditional-update in v1 |
| Admin | Same affordance on leads drawer after address save | Staff often book from Admin |

## Approaches considered

1. **Explicit sync button (selected)** — Staff opts in after address is known.
2. **Checkbox on submit** — “Also write to customer profile” default-on. Faster, but couples appointment create with profile mutation and risks customer-initiated writes.
3. **Server-side optional flag on address APIs** — Compact network call, but widens appointment mutation semantics and audit scope.

## UX by surface

### Mini Program `appointment-booking`

- Only in **staff** booking (`customerMode !== true`). Customers who self-book never see sync.
- After successful create, if actor can edit profile, lead `communityName` was empty at load (or re-check), and submitted address is non-empty: `wx.showModal` with「同步到客户小区」confirm — one-shot, dismissible.
- Ignoring the modal must not block navigation to appointment detail / prior page.

### Mini Program `appointment-detail`

- Persistent secondary control「同步到客户小区」when: staff can edit profile, appointment address non-empty, and current lead `communityName` empty.
- Also offer the same modal once immediately after a successful `saveAddress` under those conditions (so the user does not have to hunt for the control).
- Keep the approved address-row composition; the control sits in the existing full-width action stack as an additional secondary button (same height language as other secondaries).

### Admin leads drawer

- After successful address save in the existing address modal: offer「同步到客户小区」when the signed-in admin may edit profile and community is empty (Modal.confirm or inline link in the success path).

### Feedback

- Success: shared Admin operation feedback / Mini Program toast「已写入客户小区」.
- Skipped because filled:「客户已有小区，未覆盖」.
- Failure: existing lead update error path.

## Data flow

```text
Appointment address (service visit fact)
  --staff taps 同步到客户小区-->
client: if !canEditProfile or !address → hide/no-op
client: if communityName already set → toast, no PUT
client: PUT /api/leads/:id { communityName: address.trim().slice(0, 160) }
  -->
Lead profile community (card / DXF sheet / workbench labels)
```

No change to appointment versioning, `address_updated` events, or map location fields. Concurrent fill of community between check and PUT can still overwrite via ordinary lead PUT; acceptable for v1.

## Permissions

| Actor | Update appointment address | Sync to community |
| --- | --- | --- |
| Assigned designer | Yes | Yes |
| Enterprise owner | Yes | Yes |
| Assigned measurer | Yes | Yes |
| Customer | Create/book with address; not staff address endpoint | No |
| Referrer | No precise address | No |

## Testing

- Unit/UI-focused: sync control visible only when `canEditProfile` and empty community and non-empty address.
- API: existing lead PUT still accepts `communityName`; no appointment route change required.
- Truncation: address longer than 160 chars writes the sliced community value.
- No-op path when community already set.

## Open for user

Confirm or override: trigger (explicit vs checkbox), overwrite policy, measurer access, Admin inclusion.

## Implementation sketch (after approval)

| Area | Likely touch points |
| --- | --- |
| Mini booking | `appointment-booking.js` / `.wxml` — post-create sync offer; read lead community emptiness from bootstrap payload |
| Mini detail | `appointment-detail.js` / `.wxml` — after `saveAddress`, same offer; need lead community + `canEditProfile` on the page model |
| Admin | `admin/src/app/(admin)/(merchant)/leads/page.tsx` — after address modal success |
| Shared client helper (optional) | small helper: `shouldOfferCommunitySync({ canEditProfile, communityName, address })` + `syncAppointmentAddressToCommunity(leadId, address)` calling `PUT /api/leads/:id` |
| Tests | Mini focused test for visibility/no-op; Admin/API already cover lead PUT |
| Docs | `docs/miniprogram-system-modules(.zh-CN).md`, `docs/admin-system-modules(.zh-CN).md` — note the sync affordance and empty-only rule |

Client should `.trim().slice(0, 160)` before PUT so Admin lead updates match the referral-lead write limit even though `LeadRepository.update` does not slice today.

## Implementation gate

Implemented in Mini Program (`appointmentCommunitySync` helper, booking modal, detail secondary action) and Admin leads drawer (confirm after create/update address). Module inventories updated in the same change.
