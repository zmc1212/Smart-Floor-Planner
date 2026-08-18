# Retired Measurer–Designer Acquisition Contract

Status: `Retired in Phase 8`

The measurer-to-designer binding, measurer-created lead, designer acquisition confirmation, Acquisition Collaboration workbench, and fixed measurer acquisition commission have been removed from the runtime. The replacement contract is the [Referrer Network and Measurement Appointment Development Plan](./referrer-network-appointment-development-plan.md).

The retired API routes (`/api/leads/[id]/acquire`, `/api/acquisition-tasks`, and `/api/acquisition-commissions/*`), Admin acquisition-commission routes, Mini Program acquisition workbench, and old contact-sheet entry no longer exist. Staff notifications remain implemented through the shared notification repository for new-lead assignment and appointment events.

Historical database objects and business records are not migrated or deleted by this retirement change. They remain outside the runtime schema until the separately approved Phase-9 cleanup rehearsal and production release.

Chinese mirror: [measurer-designer-acquisition.zh-CN.md](./measurer-designer-acquisition.zh-CN.md)
