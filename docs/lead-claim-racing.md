# Lead Claim and Racing Assignment Runtime Contract

Status: `Implemented`

## Entries and sources

- Admin `/lead-pool` lets designers claim leads and lets enterprise owners monitor or assign manually; `/assignment-settings` maintains rules, capacity, and performance views.
- Mini Program `packages/business/lead-claim-pool/lead-claim-pool` returns masked leads only to active designers in the signed enterprise. Full lead detail becomes available only after a successful claim. The designer workbench shows the current claim count and entry.
- Referrer leads, Admin manual-entry leads, measurer activity-code leads, and enterprise-owner activity-code leads use the claim/racing path. A designer's own activity code still binds that designer directly. Measurer pre-assignment remains in the intake transaction; an owner presenter is stored as promoter only and is not bound as designer or measurer.

## Versioned settings, capacity, and racing

- Immutable enterprise setting versions contain the claim switch, window seconds, high-performance traffic percentage, signing-rate threshold, performance window, minimum effective sample, and default designer capacity. Defaults are off, 60 seconds, 70%, 30%, 180 days, 10 outcomes, and 20 open leads.
- New leads/windows snapshot the current version; later setting edits do not mutate an open window. `admin_users.leadCapacityOverride` can replace the enterprise default.
- Open load counts assigned, unarchived leads whose status is neither `converted` nor `closed`. A designer at capacity cannot claim and is excluded from automatic assignment.
- Effective signing rate is `signed ÷ (signed + normal_lost)`. Only non-invalidated snapshots with `performanceEligible=true` count; in-progress, invalid-contact, duplicate, and mistaken-entry outcomes are excluded. Signing/closure snapshots the responsible designer at that time, so later reassignment does not rewrite performance history.
- Designers meeting both minimum sample and rate threshold enter the high-performance group; all others and newcomers enter standard. Only automatic assignments advance distribution counters. Persistent compensation selects the next group that keeps the cumulative split closest to the configured target. Within a group, lowest open load, oldest `lastAssignedAt`, then staff ID are stable tie-breakers. Empty/full preferred groups fall back with an audited reason.

## Concurrency, deadlines, and closure

- `POST /api/leads/[id]/claim` uses server time, a hashed idempotency key, and `FOR UPDATE`. The same designer's retry returns the original success; concurrent designers produce one winner and `409 lead_already_claimed` for the rest.
- A claim cannot win at or after `expiresAt`, even if the worker has not scanned it. The request resolves overdue assignment transactionally as a fallback. Enterprise-owner manual assignment can end an open window at any time.
- A dedicated worker scans every two seconds with `FOR UPDATE SKIP LOCKED` and an enterprise transaction lock. No eligible designer returns the lead to `assignment_pending/designer_unavailable`, preserving the existing retry and owner in-app notification behavior.
- A designer may close their own lead with a normal lost reason. Enterprise owners may close any lead and use invalid/duplicate/mistaken-entry categories. `other` requires a note. Signing, lost closure, or archiving immediately cancels an open claim window. Reopen restores the pre-closure stage but never restores cancelled appointments; another active attribution returns a conflict. Archive remains a visibility-only concept.

## APIs and tenant boundary

- Shared APIs: `GET /api/lead-claim-pool`, `POST /api/leads/[id]/claim`, `GET/PUT /api/assignment-settings`, `GET /api/assignment-performance`, `POST /api/leads/[id]/close-lost`, and `POST /api/leads/[id]/reopen`.
- `GET/POST /api/internal/lead-claim-windows/run` is protected by `CRON_SECRET`; GET reports process-local worker health and POST executes one scan.
- Setting, window, outcome, and distribution tables have enabled and forced RLS. Business routes derive the enterprise from the signed context and never accept a client-selected tenant. The platform worker enumerates due rows in platform scope, then processes each tenant under its enterprise lock.
- Window creation always writes an in-app `lead_claim_available` record. Optional WeChat delivery is best-effort only for designers who are eligible at creation and explicitly authorized the optional template. Missing configuration, no authorization, or WeChat failure never rolls back lead intake.

Chinese mirror: [lead-claim-racing.zh-CN.md](./lead-claim-racing.zh-CN.md)
# Referrer withdrawal integration

Referrer-created leads can enter the terminal `closed` state with `terminationType=referrer_withdrawn`. The transaction releases attribution and open claim windows, preserves assignment history, and the ten-minute undo never reopens an old claim window.
