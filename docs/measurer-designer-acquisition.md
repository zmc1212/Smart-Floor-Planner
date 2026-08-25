# Retired Measurer–Designer Acquisition Contract

Status: `Retired in Phase 8`

The measurer-to-designer binding, measurer-created lead, designer acquisition confirmation, Acquisition Collaboration workbench, and fixed measurer acquisition commission have been removed from the runtime. The replacement contract is the [Referrer Network and Measurement Appointment Development Plan](./referrer-network-appointment-development-plan.md).

The retired API routes (`/api/leads/[id]/acquire`, `/api/acquisition-tasks`, and `/api/acquisition-commissions/*`), Admin acquisition-commission routes, Mini Program acquisition workbench, and old contact-sheet entry no longer exist. Staff notifications remain implemented through the shared notification repository for new-lead assignment and appointment events.

Historical database objects and business records are not migrated or deleted by this retirement change. They remain outside the runtime schema until the separately approved Phase-9 cleanup rehearsal and production release.

## Current replacement assignment extension

The retired measurer-acquisition workflow has not returned. New referrer-network leads, Admin manual-entry leads, and measurer activity-code leads now route through the independent [Lead Claim and Racing Assignment Runtime Contract](./lead-claim-racing.md): measurer pre-assignment remains immediate, while designer ownership either opens a versioned claim window or uses deterministic racing assignment when claiming is disabled/expired. Designer activity codes remain direct ownership. Claim, manual assignment, and automatic assignment do not create the retired acquisition task or acquisition commission records.

The current designer/measurer professional-endorsement feature is presentation and verified-history metadata only. It resolves enterprise defaults, employee self-configuration, administrator staff overrides, title visibility, and distinct historical customer counts after assignment/publication; it neither restores acquisition tasks nor participates in claim or automatic-assignment eligibility.

Chinese mirror: [measurer-designer-acquisition.zh-CN.md](./measurer-designer-acquisition.zh-CN.md)
