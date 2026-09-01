# Mini Program: Current Module Inventory

This inventory describes the current native WeChat Mini Program runtime. It
contains current routes, contracts, permissions, and limitations only; dated
restoration notes and test transcripts belong in Git history or local evidence.

## Runtime and shared context

- Native WeChat Mini Program with custom tab bar, bright-green design tokens,
  and iPhone 13 Pro `390x844` as the visual baseline.
- Sessions use `/api/auth/miniprogram` and bearer JWT. `GET /api/miniprogram/bootstrap`
  validates the signed context and returns the current role, valid role groups,
  enterprise/membership context, landing path, capability allowlist, and
  a server-owned badge summary (`status`/`message`/`counts` keyed by the
  current role Tab). Badge load failure keeps identity bootstrap and returns
  `unavailable` with `暂时无法读取` instead of a local zero. Phone authorization can
  create an ordinary customer account; `wechat_phone` prefers the WeChat dynamic
  `code`, and older clients that only return `encryptedData`/`iv` decrypt with a
  pre-tap `loginCode`/`session_key`. The phase-3 referral claim endpoint can
  also consume WeChat authorization codes (including that legacy ciphertext) and atomically link the account,
  attribution, and lead. Server-side phone lookup uses WeChat
  `getStableAccessToken`; archiving a lead still releases the attribution lock
  so a later scan can create a new lead. Tokens select a database-validated
  `customer`, `staff`, or `referrer` context and are invalidated by
  `contextVersion`. Professional staff, enterprise context, leads, floor plans,
  AI tasks, commissions, and promotion records resolve through shared APIs.
  On launch/resume the client refreshes the stored token against the current
  context. Mini Program staff workbench roles are `designer`, `measurer`,
  `salesperson` (渠道地推; lands on enterprise promotion records),
  `enterprise_admin`, and `platform_admin` (mapped from `admin` / `super_admin`).
  User-facing Mini Program copy displays `designer` as 家装设计顾问 and
  `measurer` as 家装现场顾问; API role keys stay unchanged.
  Platform channel `salesperson` accounts may have a null `enterpriseId` and
  still bootstrap with capabilities `promotion.records` /
  `promotion.commissions` / `account`. Platform admins land on `packages/platform/devices/devices` (moved out of the main-package `platform-device-workbench` component):
  BLE scan collects only the current scan session's live `LDMStudio 4D` MAC broadcasts
  without connecting; it can be cancelled from the same control, then checkbox /
  assign-all posts to `POST /api/miniprogram/devices` with optional SN (`serialNumber`
  on a single-device shared field or per scanned item). An already enrolled MAC is
  rejected as `该设备已录入` rather than reassigned. The registered-device list has
  a separate 查看范围 picker that defaults to 全部企业 (`GET /api/miniprogram/devices`
  with no `enterpriseId`) and can still filter one enterprise via `?enterpriseId=`;
  assignment 归属企业 stays independent of the list scope. Enterprise staff
  still must pass `POST /api/devices/verify-binding` (enterprise ownership only)
  before a single measurement connection. Refresh work is token-versioned, so a
  stale cold-start failure cannot clear a newer phone-login session; an invalid active context clears
  local session state, and a referrer
  context restores the promotion workbench instead of silently falling into the
  ordinary-customer shell.
- Primary actions use locally stored, license-documented icons. Native host
  capsule and safe areas remain outside the content lane.
- The source package explicitly excludes development folders, tmp preview
  scripts, and local design-token files through `project.config.json`
  `packOptions.ignore`; unused historical rasters were deleted from the source
  tree rather than left in ignore. The primary package keeps only its current
  runtime assets and leaves margin below the WeChat 2MB source-package limit.
  The survey wall-graph kernel lives in the surveying subpackage
  (`packages/surveying/utils/surveyWallGraph.js` and `packages/surveying/utils/survey/`);
  the main package keeps a kernel-free `utils/surveyLayout.js` for lead-list
  previews and business read models. The three surveying guide poses under
  `packages/surveying/assets/surveying-guide-k-*-v3.png` are indexed-palette
  transparent PNGs so that subpackage stays under the same 2MB source cap.
  Main-package artwork under `images/` is
  palette-optimized in place. The
  `packages/business` subpackage stays under the separate 2MB subpackage
  source-size cap by packaging only runtime artwork (palette-optimized PNGs)
  and loading Xiao K mascots from the main-package `images/airy-v1` copies
  instead of duplicating them under business.
  Platform-admin review and device-enroll pages live in a separate
  `packages/platform` ordinary subpackage (not independent: it reuses the main-package
  custom TabBar, `utils/api.js`, and `utils/bluetooth.js`) and stay under the
  same 2MB subpackage source-size cap.
  Role-guide pages and their generated artwork live in a separate
  `packages/guides` subpackage; runtime illustrations are palette-optimized
  transparent PNGs so the subpackage stays under the independent 2MB source
  cap, and each generated PNG remains at or below 300KB.
- `Implemented`, `Limited`, and `Placeholder` describe executable runtime
  behavior, not labels or mock responses.

## Page inventory

### Current three-role workbench and data contract

The following V3 record is historical context for the former enterprise-owner portion of the single `pages/index/index` route:
`design-references/enterprise-owner-activity-code-entry-v3/enterprise-owner-operations-home-v3.png`.
The approved V3 structure is the equal-width acquisition pair, regular three-stage operations path,
two short card-to-card connectors, two efficiency tiles, and the pale-mint priority tray. Stage two is the
period-scoped `已发布方案 N 份` detail from `schemeFacts.publishedLeadCount`; the owner-facing
ambiguous `闭合率` detail is no longer rendered. The V3 business cutouts were generated as independent
transparent PNGs with ImageGen. Unused V3 rasters (`lead-inbox.png`,
`staff-onboarding.png`, `scheme-delivery-rate.png`, `signing-rate.png`) were
later removed from the runtime package. Current production keeps
`images/operations-dashboard/enterprise-guide.png` (17,943 bytes) and
`staff-load.png`, plus the density-v2 / operations KPI cutouts listed below,
each below `300KB`. The composite design
reference is never sliced into runtime assets. The source-calibrated V3 owner ledger is: the enterprise-only
Hero top row has a `114rpx` content reserve, the three status pills start after `12rpx` and finish alongside
the bottom of the absolutely positioned `190rpx` Xiao K box, both acquisition actions are white equal-width
tiles with `136rpx` minimum height, and their activity/onboarding icon boxes are `64rpx` / `72rpx`
(`60rpx` / `68rpx` on viewports at or below `360px`). Action title/helper type is `30rpx` / `24rpx`
(`28rpx` / `22rpx` on those narrow viewports). The operations board uses horizontal padding `24rpx`,
green native kicker `26rpx`, stage height `168rpx`,
stage-card padding `18rpx 18rpx 14rpx`, stage gap/connector `44rpx`, efficiency gap `20rpx`,
efficiency-card padding `18rpx 20rpx`, icon box `72rpx`, and minimum height `146rpx`. The user-supplied tall-device capture exposed a second overlaid plus and a
full-width progress rail below the stage cards; production now uses the single packaged glyph and two
card-to-card connector segments. During a staggered backend rollout, a legacy `闭合率` detail is hidden
behind the truthful `方案同步中` fallback until the period-scoped publication count arrives.
Existing route, API, permission, and native-data boundaries remain unchanged; refreshed runtime QA is pending.
The latest white-card review replaces the low-contrast onboarding cutout with the standalone built-in-ImageGen
source `design-references/enterprise-owner-activity-code-entry-v3/staff-onboarding-white-card-v2.png`; that
V3 raster was later removed from the runtime package in favor of `team-onboarding-v2.png`. The staff-load Xiao K box is `120rpx × 104rpx`, and
the three stage cards use a `34rpx` ordinal disc, `26rpx` title, `168rpx` height, and `14rpx` bottom padding, reducing unused lower whitespace while allowing a two-line detail to grow intrinsically.

The current approved sources are `design-references/role-workbench-unification-v1/pages-index-three-role-workbench-v2.png` and `design-references/role-workbench-unification-v1/pages-enterprise-operations-role-data-v1.png`.
`pages/index/index` now uses one approved professional-workbench shell for `enterprise_admin`, `designer`, and `measurer`. Each state keeps the capsule-safe identity row and a fixed `252rpx` green Hero containing only its role title, role Xiao K artwork, and three existing server-derived summary values. The next section is always the asymmetric one-large/two-small acquisition hub. Owners see **获客与团队** with **分享活动码**, **邀请入驻 · 员工 · 推荐人**, and **查看推广人 · 全店推广网络**; designers and measurers see **获客与推广** with **分享活动码**, **邀请入驻 · 仅推荐人**, and **我的推广人 · 仅查看本人网络**. `GET /api/miniprogram/workbench` returns `activityCode`, `joinCode`, and `referrerRoster` for all three roles. Existing `enterprise-join-codes` and `enterprise-referrers` routes continue to server-force `scope=enterprise` for owners and `scope=own` for ordinary staff, so staff cannot view employee branches, the complete enterprise roster, or disable promoters. The owner retains appointment/reminder/insight and exception sections; designer customer/claim/design work and measurer BLE/calendar/unavailability/formal-survey tasks follow the shared hub. The overview runtime reuses the existing standalone transparent PNGs under `miniprogram/images/operations-dashboard/` and the existing designer/measurer Xiao K images; no composite design is sliced. `pages/enterprise-operations/enterprise-operations` remains the one native registered data route. Owners still see **经营** with the existing four-KPI Hero, enterprise loop, efficiency cards, owner-only `contractAmountSum`/`contractAmountTrend`, and `enterprise.operations` scope. Designers and measurers see **数据**, use the same period/custom-range controls, and render only their five own-scope facts from the existing staff-filtered dashboard query: new leads, completed surveys, scheme delivery rate, signed count, and signing rate. Their production layout restores the approved `290rpx` mint Hero, source-ordered `3+2` KPI matrix, and one icon-led four-stage path instead of the previous generic five-card-plus-duplicate-values structure. Route-specific transparent PNG mappings are `images/operations-dashboard/{staff-data-designer-v1,staff-data-measurer-v1,scheme-delivery-kpi-v1,signing-rate-kpi-v1}.png`; each is independently generated or composed from standalone business artwork, palette-optimized, and below 300KB. The employee branch contains no contract amount, trend, or store-wide wording. Bootstrap and client route guards add `staff.data`; designer tabs are **工作台 / 数据 / 客户 / 设计 / 收益 / 我的**, measurer tabs are **工作台 / 数据 / 客户 / 收益 / 我的**, and owner tabs remain **工作台 / 经营 / 客户 / 提成 / 我的**. Native `tabBar.list` stays at five pages, while the custom bar safely renders six designer items at the `390x844` baseline. Authenticated native-capsule screenshots remain pending the user's manual review.

The 2026-08-28 workbench visual correction changes no route, API, permission, or server data contract. It restores the approved action-card optical scale and spacing: `34rpx` hub title; `36rpx`/`26rpx`/`28rpx` primary action hierarchy; `32rpx`/`24rpx` secondary action hierarchy; the activity-code illustration uses a `220rpx` box (`184rpx` at `<=360px`) so it stays below the copy. The appointment row is `80rpx` and displays a truthful `payload.appointments.length`; the `72rpx` reminder row has a title divider and evenly distributed live facts. Insight cards are `176rpx`; their `40rpx` arrow controls occupy a separate lower lane, while the staff-load artwork uses a bottom-right `120rpx × 96rpx` box. Priority CTAs keep a `52rpx` height but use a compact `10rpx` corner radius. Authenticated `390x844` runtime QA remains pending the user's manual screenshot.

### Shared Mini Program statistic formatting

All compact KPI, summary-card, badge, points, and quantity displays now share native-template `miniprogram/utils/stat-format.wxs`. `stat.count` keeps small values literal and shortens larger values (`1.5千`, `5万`, `100万`); `stat.money` keeps the unit with the value (`5万元`, `10万元`, `100万元`, then `亿元`/`万亿元`); `stat.percent` removes unnecessary decimal zeroes. The formatter is used by workbench/operations, schedules, referral and earnings summaries, commission summaries, Mine, service/archive count labels, lead delivery counts, and AI recipe/workflow/history/result statistics. It is deliberately not used for a commission ledger row, a lead conversion detail, an editable form value, or another reconciliation/detail amount: those remain exact. This is a presentational-only WXS change with no route, API, permission, or data-contract change; the approved page structures and source artwork are retained. The affected `390x844` native-capsule states require the user's manual runtime capture for final visual confirmation.

Appointments retain a manual service address plus an optional WeChat-map `gcj02` location (`locationName`, latitude, longitude). Booking keeps manual building/unit/room entry and adds native `wx.chooseLocation`; the assigned designer, measurer, or enterprise owner can update the same location through the existing versioned `POST /api/appointments/[id]/address` authorization and audit. That endpoint resolves Mini Program staff identity before Admin JWT so a measurer is authorized by `staff._id === appointment.measurerId`, not the WeChat user id. Creating or updating an appointment copies an empty lead `communityName` in the same transaction from the map `locationName` when present, otherwise the typed service address (trimmed to 160 characters; never overwrites). Appointment detail still offers staff an explicit sync for historical empty communities via `PUT /api/leads/[id]`. A confirmed appointment with coordinates opens native `wx.openLocation` for its authorized viewer; the measurer calendar uses it for its navigation shortcut. Historical/manual-only appointments remain valid but explain that a map point is not recorded. Referrers never receive exact addresses or coordinates.

### Identity switch card presentation

`packages/business/identity-switch/identity-switch` presents every active server
identity context in a two-column native card grid. Role names, including
`家装设计顾问` and `家装现场顾问`, are always fully readable; card selection remains
local until the existing native confirmation exchanges the signed context token.
The current context is explicitly marked. The role-tool artwork is independently
generated, transparent PNG content under
`packages/business/assets/identity-switch/role-cards/`; no approved composite
design is sliced into the runtime package. This changes neither the route nor
the `GET/POST /api/miniprogram/identity-contexts` permission contract.

| Surface | Runtime routes | Current contract | Status/limitation |
| --- | --- | --- | --- |
| Designer lead claim pool | `packages/business/lead-claim-pool/lead-claim-pool`; designer state of `pages/index/index` | The approved claim-pool design adds a capsule-safe independent pool and a workbench alert/count entry. `GET /api/lead-claim-pool` returns server time, expiry, claim state, capacity state, and only masked identity/location plus area/style/source until success. The page calibrates its countdown to server time and refreshes every three seconds; loading, empty, disabled, expired, capacity-full, concurrent-loss, and success states preserve the approved layout. `POST /api/leads/[id]/claim` uses a client idempotency key; success opens full lead detail. **开启抢单提醒** is an explicit, user-triggered `wx.requestSubscribeMessage` request for the optional `lead_claim_available` template only. Referrer/manual-entry/measurer-code/enterprise-owner-code leads enter the pool when enabled; designer activity codes still bind directly | Implemented/Limited; only active, assignment-eligible designers in the signed enterprise may claim. A missed deadline cannot win even when worker resolution is delayed. The optional WeChat template requires operator configuration and user authorization; in-app records remain authoritative. Approved sources: `design-references/lead-claim-racing-v1/designer-lead-claim-pool-v1.jpg` plus its approved state sheet; fresh authenticated `390x844` native-capsule capture is pending |
| Home and measurement entry | `pages/index/index` | Customer Service home follows the approved three-free-benefit stage companion (`docs/superpowers/specs/2026-08-25-customer-service-home-three-free-design.md`): one capsule-safe green field foregrounds `免费效果图`, `免费家装设计顾问`, and `免费家装现场顾问`, with complete Xiao K holding the three semantic cards once. The three benefit cards now use the route-specific main-package `effect-room.jpg`, `design-advisor-3d.png`, and `onsite-advisor-3d.png` assets generated against the approved design; generic reference/bulb/map-pin icons are not used as illustration substitutes. In the no-media state, stage copy and the four-step rail share one row before the action row. The overlapping native service ticket still consumes derived `serviceStage`/`nextActionKind`, one customer-readable `appointmentSummary`, the four-stage rail, real floor-plan/published-scheme previews only, and existing primary action (`book` / `reschedule` / `rebook` / wait / archive). Customer ticket copy on this route drops 上门: inset titles `待预约量房` / `已预约量房` / `量房进行中`, summary `可预约量房时间`, and book CTA `预约量房`; staff workbench and booking-page 上门 wording stay. Primary and archive actions share one row when both exist. The three native benefit cards keep existing behavior: effect image opens the current lead's delivered-scheme folio `customer-ai-schemes` (or scan acquisition when empty; unpublished leads keep the folio empty state), design advisor opens the shared WeChat contact flow, and on-site advisor opens booking/reschedule/archive. Empty/early states never invent media. The reassurance strip combines `三项服务不收费` with a stage-derived truthful status. The identity-nav keeps service/invite scan and omits the bell; `GET /api/miniprogram/customer-projects` still feeds urgency ranking and the `N = length − 1` switcher, while `customer-projects` remains a deep-link redirect shell. No route, API, permission, media, or stage-derivation boundary changes. Signed designers and measurers enter the shared role-workbench shell. The measurer's BLE connection, `measurer-calendar`, and unavailability controls now follow the shared acquisition hub; the existing `ble-connector` remains live, while formal survey still enters only from assigned task cards (`立即量房` / `继续量房` / `新增量房`), never from the Hero. The measurer workbench is lead-oriented: for one lead, a replacement `confirmed` appointment replaces any earlier `expired` appointment in task cards and counts; without a confirmed replacement, only the latest expired appointment remains as the pending task. The calendar retains appointment history. Unscheduled measurer task cards without a floor plan keep `立即量房` plus `预约上门`; when an activity-code lead has already locked the measurer but designer assignment is still pending, the card badge stays `待量房` and meta shows `未预约上门` instead of pairing enterprise `待派单` beside it; a draft linked plan switches the same card to `继续量房` (loads `floorPlanId`) and `新增量房`, and hides booking. A completed formal v4 plan stays in the pending workbench queue (badge `待确认完成`, stage `survey_ready`) until appointment `completed`; only then does it leave the queue and `待量房任务` count. Past-end `confirmed` visits that already have a submitted formal plan are not expired, and converted/closed leads leave both confirmed and expired workbench cards (`shouldIncludeMeasurerWorkbenchAppointment`); the calendar still keeps full appointment history. Confirmed appointment cards in `survey_ready` promote `确认完成量房` as the primary chip (opens appointment detail); `继续量房` / `新增量房` stay secondary so the saved graph can still be reopened until the visit is confirmed complete. Enterprise-owner Operations follows `design-references/enterprise-owner-activity-code-entry-v3/enterprise-owner-operations-home-v3.png` (the custom filter sheet remains `18c-enterprise-ops-dashboard-filter-sheet.jpg`): capsule-safe identity-nav (no scan/bell; Logo + role lockup such as `家客来 · 家装设计顾问端` left-aligned on the capsule row; enterprise name under `家客来` inside the same capsule height; signed staff name above the green Hero title), hero pills (`待派单`/`待量房`/`待交付`), quick nav (`待处理线索`/`人员负荷`), period-filtered ops dashboard (chips `本周`/`本月` default/`本年` + custom bottom-sheet; the owner's same five read-only KPI values are reorganized into the regular three-column `新增线索 → 已完成量房 → 已签约` operations path; stage two shows the period-scoped `已发布方案 N 份` detail from `schemeFacts.publishedLeadCount` plus secondary `方案交付率` / `签单率` efficiency tiles; owner subtitle `全店 · …` may include签约金额 detail; the integrated pale-mint exception tray keeps all copy/data/actions native; V3 business illustrations use only the standalone ImageGen cutouts mapped to `images/operations-dashboard/enterprise-guide.png`, `lead-inbox.png`, and `staff-load.png`), an acquisition-first Hero pair: the white primary 分享活动码 tile (helper 发给客户 · 扫码留资; reuses packages/business/staff-activity-code/staff-activity-code and its real customer share; owner codes are store-level intake into claim/racing, not a designer/measurer bind) plus the white secondary 邀请入驻 tile (helper 员工 · 推荐人; opens packages/business/enterprise-join-codes/enterprise-join-codes with generate/rotate/disable; WeChat modal confirmText stays <=4 chars so generate is not a silent no-op), a full-width 已入驻推荐人 row under that pair into `packages/business/enterprise-referrers/enterprise-referrers`, and exception cards for pending assignment, expired unrebooked work, and staffing gaps (pending assignment opens lead detail, expired unrebooked opens appointment detail, staffing-gap 查看详情 and 人员负荷 open `packages/business/enterprise-staff/enterprise-staff` — owner-only designer/measurer roster with pause/resume via `GET/PATCH /api/miniprogram/enterprise-staff`; WeChat ID/QR remain self-serve on `profile-edit`, and empty roster CTAs open join codes), all from `GET /api/miniprogram/workbench?period=`. Designer/measurer period dashboards moved from Home into the role-aware native **数据** Tab and keep the same five own-scope facts with no contract amount. Isolated workbench task-card CTA images (`立即量房` and sibling chips) are explicitly `28rpx` so they do not fall back to the native 320×240 `<image>` default. The designer overview no longer renders the static「常用配方」strip below the delivery list; quick-nav「风格配方」still opens the Design tab. Hero `待交付` counts unarchived designing-group leads with no customer-visible publication; publishing a scheme or marking converted removes the lead from that snapshot. Period `已签约` remains windowed `convertedAt` conversions. The local `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` switch opens a fresh editor without loading recent plans | Implemented/Limited; unsigned visits stay on this root route and render the approved customer Service empty/early companion so the three free benefits can be browsed before login; they are not auto-sent to Mine. The legacy marketing home shell is still not a second logged-out page. Unsigned sessions reuse the customer Service/Mine TabBar; phone/avatar/nickname authorization remains user-initiated on the login page. Role workbenches consume server-derived `GET /api/miniprogram/workbench` and the customer list/detail `serviceStage`/`nextActionKind`, and must not invent a second stage vocabulary. Dashboard signing facts are read-only KPIs (`status=converted` via `convertedAt`); the home surface still does not offer签约/改状态 actions. On cold launch, the custom TabBar and role pages derive the first render from the stored signed `mode/staffRole` context. The customer TabBar exposes only Service and Mine. Tab badges come from bootstrap `counts` (customer first-booking/reschedule/rebook, designer follow-up plus expired, measurer combined workbench badge (today plus pending survey tasks), designer/measurer payable earnings, owner exceptions including expired unrebooked); failed counts show `暂时无法读取` and never a local zero. Authenticated `390x844` native-capsule QA for the new role states remains pending. The legacy marketing home shell no longer calls `wx.getLocation` or `POST /api/location/reverse`; signed roles render `role-workbench`, and any leftover city label is profile/community-derived only.|
| Leads and customer records | `pages/leads-management/leads-management`, `packages/business/lead-form/lead-form`, `packages/business/lead-detail/lead-detail`, `packages/business/customer-ai-schemes/customer-ai-schemes` | Lead list/detail, conversion state, formal-plan summary; staff list may temporarily filter by `referrerMembershipId` from the owner branch **查看推广客户** entry (clearable chip; leave-and-return auto-clears); list cards put community on its own row under the phone (two-line clamp) instead of sharing the contact line with the plan thumbnail; lead-detail hero keeps 小区 as a wrapping block inside a 360rpx green copy lane whose diagonal edge stops just left of Xiao K, with a light text-shadow so long white copy stays readable; list thumbnails prefer formal `previewUrl` through `fetchProtectedImage` (`GET /api/floorplans/[id]/preview`), then Kujiale `externalSource.previewUrl`, then CSS wall segments. Unarchived lead detail pins **补充资料** as an absolute top-right Hero action with packaged `images/mine-icons/edit.png` (read-only status pill stays text-only beside the copy lane); customer and staff phone rows use shared `.sfp-icon-action` + `images/leads-v4/phone.png` (white sheet punched to alpha; hero phone left-aligned with the copy lane, handset icon after the number, and keeps `手机：` + number) and open `wx.makePhoneCall`; a two-card strip shows the assigned designer and measurer name and phone from `GET /api/leads/[id]` `assignedTo`/`measurerId` staff summaries (unassigned renders 待分配). Each card puts **分配** / **更换** on the right when `assignmentActions.canAssignDesigner` / `canAssignMeasurer` is true (24rpx brand green; phone stays a separate `.sfp-icon-action` tap). The picker loads `GET /api/leads/[id]/assignable-staff?role=` and submits `POST /api/leads/[id]/assign-staff`, which can fill or replace staff; measurers never see those actions, and enterprise admins plus the assigned designer or assigned measurer open `lead-form?mode=edit` (default WeChat navigation with the native back control) to update name, phone, community, area, and style through `PUT /api/leads/[id]`; communityName on that form accepts native `wx.chooseLocation` (POI name, sliced to 160) plus manual typing, matching appointment booking’s map-plus-input path, and does not persist map coordinates on the lead; enterprise admins still create customers from the list (`source=manual_entry`); those leads use the same designer/measurer pool assignment as referral-network claims; an open same-enterprise lead with the same phone (including WeChat 86-prefixed numbers) is reused and bound to that WeChat customer, and they snapshot designer plus measurer commissions on signing. Scan claims also attach to an unowned open manual lead with the same phone instead of creating a second 微信客户 card. The assigned designer can enter first booking when no confirmed appointment exists, and a staff-activity measurer can book the first visit for that same lead; the owning customer can enter the same server-backed booking flow from Service home after measurer assignment and from the project folio. Automatic measurer assignment is displayed separately from the pending appointment time. Designer, measurer, and enterprise-owner Customers tabs share the same `leads-management` + `lead-list` shell; list scope stays role-scoped (`promoted-or-assigned` for designers, `measurer`/`measurerId` for measurers—aligned with the workbench task queue—and tenant-wide for enterprise owners), create-customer remains enterprise-owner only, assigned designers may start, continue, add, or delete formal surveys from their assigned lead detail, assigned measurers continue to enter formal surveying from their Workbench tasks, and enterprise owners may start, continue, add, or delete formal surveys from any tenant lead detail. Today's pending survey queue (confirmed appointments and unfinished formal surveys) remains on the measurer Workbench overview, not the Customers tab. `GET /api/leads/[id]` now counts active AI publications when deriving `serviceStage`/`nextAction` and returns `publishedSchemes` ordered by `firstPublishedAt` with images that include `stageKey`/`publishedAt`; lead detail merges the appointment CTA into the formal-survey card (no standalone appointment container); the appointment CTA and **开始量房** / **继续量房** share one equal-width 84rpx pill row (16rpx gap) when both are visible, and a lone CTA stays full-width; when a saved plan also exposes **新增量房** and delete, that second row uses the same equal columns, 84rpx height, 16rpx gap, and pill radius; when `serviceStage` is `survey_ready`, it relabels that appointment CTA to `确认完成量房`; it hides the CTA after `survey_completed` / `converted` / `closed` (publication alone does not end makeup booking) while keeping house facts (community, area, stored appointment address, closed room names) plus a protected floor-plan PNG preview for enterprise admins and the assigned designer/measurer (`wx.previewImage`; assigned designers, owners, and assigned measurers may also use their authorized editor action), an embedded **房屋现场图** grid (`GET/POST /api/miniprogram/leads/[id]/site-photos`, tag-first 客厅/主卧/次卧/主卫/次卫 then camera/album, cap 30, soft-delete gallery rows only), and published-scheme summaries open the read-only `customer-ai-schemes` folio (`mode=staff`); designers and enterprise owners see **进入 AI 设计** on lead detail for any unarchived open lead even before survey completion (empty **方案设计** helper **可用现场图开始出图**; after `survey_completed` or a completed formal plan, **量房完成，可开始出图**). A completed formal plan still binds `floorPlanId`; otherwise `openAIDesignEntry` opens scheme-studio with `leadId` only (`rough_sketch`). `survey_ready` keeps the plan preview; assigned designers, owners, and assigned measurers may continue the saved survey; when publications exist, **查看全部方案** and **进入 AI 设计** share one equal-width row (16rpx gap), and a lone CTA stays full-width, while the Design tab remains the general creation entry. The designer workbench uses the same publication count for `方案已发布` badges, prioritizes unpublished survey work ahead of published follow-ups, and omits converted/closed leads from follow-up cards because a signed lead ends platform progression. JWT-backed staff sessions load the list without requiring a legacy OpenID. The 客户 tab loads that list on first attach, when returning to the tab, and on filter or pull-to-refresh; it does not background-poll. When a referral-network lead enters `converted` through the existing signing endpoint, the server snapshots referrer, designer, and measurer commissions in the same transaction; staff-activity leads snapshot designer and measurer only | Implemented/Limited; conversion, customer ownership, appointment-entry, manual-assign, and preview permissions are server enforced, and role Tab items are capability-allowlisted. Percentage rules require a contract amount and a paid three-role commission blocks enterprise-admin signing reversion |
| Promotion and staff tasks | `packages/business/promotion-records/promotion-records`, `packages/business/promotion-record-detail/promotion-record-detail` | Enterprise referral and staff notification flows; channel-salesperson bootstrap lands here (`我的报备` / pool / create) with TabBar `报备` + `我的` (embedded custom TabBar; icons reuse `tab-home` / `tab-mine`). Subscription taps for staff lead events open `lead-detail`, customer appointment/design taps open `customer-project` | Implemented/Limited; WeChat delivery can fail externally |
| Referrer network, appointments, and anonymous claim | `packages/business/onboarding/onboarding`, `packages/business/enterprise-register/enterprise-register`, `packages/business/onboarding-debug/onboarding-debug`, `packages/business/referrer-workbench/referrer-workbench`, `packages/guides/referrer-guide/referrer-guide`, `packages/business/referrer-progress/referrer-progress`, `packages/business/referrer-earnings/referrer-earnings`, `packages/business/staff-earnings/staff-earnings`, `packages/business/enterprise-commissions/enterprise-commissions`, `packages/business/promotion-service-code/promotion-service-code`, `packages/business/staff-activity-code/staff-activity-code`, `packages/business/enterprise-join-codes/enterprise-join-codes`, `packages/business/enterprise-staff/enterprise-staff`, `packages/business/enterprise-referrers/enterprise-referrers`, `packages/business/free-design-service/free-design-service`, `packages/business/customer-projects/customer-projects`, `packages/business/customer-project/customer-project`, `packages/business/customer-ai-schemes/customer-ai-schemes`, `packages/business/appointment-detail/appointment-detail`, `packages/business/appointment-reschedule/appointment-reschedule`, `packages/business/appointment-booking/appointment-booking`, `packages/business/measurer-calendar/measurer-calendar`, `packages/business/enterprise-appointments/enterprise-appointments`, `packages/business/measurer-unavailability/measurer-unavailability`, `packages/business/identity-recovery/identity-recovery` | Type-isolated onboarding, promotion code, anonymous claim, customer project, and appointment deep routes retain their contracts. Platform open-account scans land on `enterprise-register`: `POST /api/miniprogram/codes/resolve` accepts `er_` / bare 32-char scene as `kind: enterprise_registration` (platform label only, never a fake enterprise name); after `getPhoneNumber`, `POST /api/miniprogram/enterprise-registration` (Bearer JWT) requires authorized phone === `contactPerson.phone` and shares `createSelfServiceEnterpriseApplication` with Web `POST /api/auth/register-enterprise` (`pending_approval` / `self_service`). UI reuses onboarding brand-lock / airy tokens without a separate design file or new IP art, plus the claim-page back chevron so a QR stack-root can leave; a recents reopen with a signed identity is not sticky, while a chat-card share stays on the form. Staff/referrer `ej_` onboarding remains separate. The `referrer.network` capability extends the existing join-code and roster surfaces without a new visual system: the owner receives the enterprise staff-code tab plus their personal referrer-code tab, while designers, measurers, and salespeople receive only their personal referrer-code tab. The resulting memberships stay enterprise-owned but retain the first inviter; staff read only their own invitees, and the owner can switch between the grouped employee network (including zero-count and historical-unassigned branches) and the flat enterprise roster. Disable remains owner-only and no reassignment action is exposed. The enterprise-owner appointment schedule (`enterprise-appointments`) is a TabBar-free secondary page from workbench **查看预约安排** (`navigateTo`); it restores R03 `20-enterprise-appointments.jpg` as a dedicated schedule list: capsule-safe back plus “预约调度中心” header, real period appointment count, chips 本周/本月/本年 plus custom range (selected custom dates sit after the 自定义 chip, not in the nav subtitle), a day strip for the selected Shanghai window, and `confirmed`/`expired` cards; expired cards show “需协调改期” plus a view-appointment CTA only when the linked lead is still open, overdue expired or past-end open-lead appointments that fall before today still appear on the today list, archived or missing linked leads hydrate as `closed` so the tab never paints a fake 客户量房 card that opens availability and errors, while `serviceStage` `converted`/`closed` cards keep a read-only “已签约”/“已关闭” badge with no CTA or detail navigation because a signed lead ends the platform lifecycle; no new dispatch API and no area/layout/measurer-phone fields the workbench item does not return. `GET /api/miniprogram/customer-projects` returns only unarchived projects owned by the current JWT customer (neutral free-design labels) and feeds Service-home ranking/switcher; the customer project folio omits enterprise branding while retaining the owner-only service facts. The retired `customer-projects` route is a deep-link redirect shell (rank → archive or Service tab), not a product list; the project folio remains the real deep route without the TabBar. Its featured delivery header now renders the API-provided scheme title as `已发布{title}方案`; `详情` and `查看全部方案` open the read-only `customer-ai-schemes` folio (`mode=customer`, no generation/edit; round chips ordered by first publication + delivery timeline over `publishedSchemes`, preview via `wx.previewImage`), and the fixed WeChat contact action text stays centered. The referrer progress route is the 客户 Tab: capsule-safe `我的推荐客户` Hero with Xiao K as file clerk, opaque record-code cards, a solid 撤回 pill, and a 10-minute 恢复 window. Referrer progress and earnings are scoped to the signed active membership for authorization; earnings rows follow the current commission `beneficiaryUserId` and `payableAmount` (so a payable beneficiary change moves the row to the new eligible referrer), and return only masked customer labels, service facts, and the referrer's commission state, never a phone number, exact address, wall graph, internal appointment reason, or design file. The referrer-workbench identity-nav brand mark uses production `/images/home-ip-v1/brand-logo.png` (house + JK lockup shared with customer/staff workbenches) instead of the compositor's green `JK` text squircle. Logo + `家客来 · 推广端` stay left-aligned on the capsule row, and the signed user name stacks directly under `家客来` inside the same capsule height (hidden when absent; long names ellipsize). Selecting an in-workbench referrer enterprise exchanges the signed membership context before the session is refreshed, so its service code, progress, and earnings share that boundary. A valid onboarding code resolves code type and enterprise before phone authorization; a referrer must set a real display name after phone authorization before `POST /api/miniprogram/onboarding/referrer`; a signed customer who already has an open attribution receives the existing project instead of a new claim. Claim/login surfaces `staff_phone_linked_to_other_user` as “该手机号已绑定其他微信账号…” so users can switch phone or ask an admin. Promotion and staff service-code presenters share the activity-code intrinsic mint-poster scale (the anonymous promotion code omits the enterprise name); the anonymous claim phone-authorization state now uses the approved three-benefit design with `装修问题找微信家装顾问，免费问清楚`, only `免费效果图`, `免费家装设计顾问`, and `免费家装现场顾问`, a phone privacy note, and authorization/skip actions. It removes the phone-auth acquisition stepper plus every home-visit, surveying, appointment, address, and designer-matching prompt; success, assignment-pending, and existing-attribution behavior remains unchanged. Design 09 scan glyphs on the 请扫码 plaque, share CTA, and enterprise dual-code plaque reuse packaged `images/mine-icons/scan.png` (brand green on the plaque, white on the green CTA). Development-only `onboarding-debug` can select a local code into the same real flow. Appointment actions remain separated among designer, measurer, enterprise owner, and customer; appointment detail hides reschedule/cancel/rebook/survey mutate actions when the linked lead is converted, closed, or archived; internal reschedule reasons are optional and retained in appointment event audit when supplied. Invalid identities enter a dedicated recovery page before reauthentication The approved three-step referrer guide is implemented as native WXML/Less in the separate `packages/guides` subpackage, with its three generated transparent PNGs kept out of the main package. It auto-opens once per local signed account/role/v1 after referrer-workbench load, remains replayable from Mine, and requires `referrer.promotion`; skip returns to the caller and the final CTA opens the selected membership's service code. Customer remains non-forced and no customer placeholder is shipped before its own design approval. | Implemented/Limited; platform enterprise open-account page is Implemented with focused contract tests. A referrer enters the workbench after onboarding, login, and JWT-backed cold launch. A real signed referrer verified both login completion and cold launch at `390x844`, including a native-capsule host capture. The workbench now opens masked progress and own earnings for its current enterprise and keeps membership leave without hosting identity switch or logout; customer-project ownership, appointment role checks, and optimistic versions remain enforced. A temporary identity-context read failure leaves promotion controls usable; identity switch remains on Mine only. Customer-facing project surfaces intentionally use neutral free-design/free-survey copy; enterprise names remain available only to internal/referrer surfaces. The claim phone-auth hero never renders a renovation-company name for referral or staff-activity scans; the staff-activity presenter may still show the enterprise name. Phase 12 now exposes the current executable referrer/measurer navigation from bootstrap and clears invalid sessions without exposing the invalid tenant. Authenticated `390x844` native-capsule capture of the enterprise appointments page, enterprise-register page, and the changed personal-code / owner-network / employee-own-roster states remains pending the user's manual screenshot; new customer-project, progress, earnings, and customer AI scheme routes still need authenticated `390x844` QA; measurer-task aggregation, authenticated appointment/publication actions, and full role production UI remain pending; WeChat delivery is external |
| Platform admin review and devices | `packages/platform/enterprise-review/enterprise-review`, `packages/platform/enterprise-review-detail/enterprise-review-detail`, `packages/platform/devices/devices`, `packages/platform/registration-code/registration-code` | Custom TabBar `设备` / `审核` / `我的` (`reLaunch` into the subpackage; review and the open-account presenter are never in native `tabBar.list`). Devices keeps the previous BLE enroll/list contract (`GET/POST /api/miniprogram/devices`). Review defaults to `pending_approval` via `GET /api/miniprogram/platform/enterprises?status=`; `q=` searches name, credit code, and contact phone within the current chip. Detail adds status events; `POST .../enterprises/[id]/status` reuses Web FSM/provision/`enterprise_join_result`. Chips: 待审核 / 全部 / 已拒绝 / 已停用. Approve uses `wx.showModal`; reject/disable use a 4–200 character reason sheet. Phone rows call `wx.makePhoneCall`. Review nav **开户码** and Mine **出示开户码** open the read-only `er_` presenter (`GET /api/miniprogram/platform/enterprise-registration-code` plus `/image`, same `revealActive` path as Admin “查看不换新”; no rotate/disable). Visual language reuses the device workbench capsule nav plus appointment-list cards; no Xiao K, AI keys, or automation config. `counts.review` is the pending-approval badge. Hitting `pages/index` `reLaunch`es to the devices landing | Implemented/Limited; `admin`/`super_admin` Mini JWT only. Rotate/disable and code environment stay on Web. Authenticated `390x844` native-capsule capture is pending the user's screenshot |
| Commission records | `packages/business/commission-records/commission-records` | Order commissions for eligible commercial roles (channel/salesperson「我的提成」); staff signing-earnings WeChat taps land on `staff-earnings` instead | Implemented; settlement remains backend/business controlled |
| Conversion commission lifecycle | Shared `POST /api/leads/[id]/convert` and `POST /api/leads/[id]/revert-conversion`; enterprise-owner payout ledger | Signing snapshots role rows in the tenant transaction. Revert keeps the complete voided-row snapshot in `conversion_reverted` lifecycle-event metadata. Re-sign refreshes the existing rows from the new contract amount, current rules, and current beneficiaries, clears prior void/adjust state, and returns them to `payable` instead of leaving them `voided` | Implemented/Limited; enterprise owner alone can revert, and any paid row blocks reversion |
| Inspiration library | `packages/business/inspiration/inspiration` | Tenant-scoped inspiration browsing and detail | Implemented/Limited; media provider is external |
| AI design workflow | `pages/ai-design/ai-design`, `packages/ai-workflow/*` | Designer Design tab follows D01 (`37-ai-design-workbench.jpg`): green create-scheme hero, popular recipe discovery (static input-capability descriptions without a false selectable state, featured strip, waterfall; recipe card covers bind the imported HTTPS Roomi COS URL when stored, otherwise a signed Mini recipe-preview JPEG), and recent design-project cards that open `scheme-studio`. Space chips strictly filter the loaded recipe set; a category with no matching recipe uses the existing empty state rather than silently showing another category. Each recipe opens with a compatible supported input mode. The Design tab remains the **creation entry** (recipe discovery, not the scheme archive). Using a recipe keeps `recipe-detail` → `recipe-project` (pick customer from `GET /api/miniprogram/ai/studio/leads`; on the customer step, returning to the page — including after surveying — silently reloads that list so a visit confirmed complete (`survey_completed`) moves the lead into 可设计 (`survey_ready` submitted plans stay 待量房). Photo recipes (`inputMode=photo`) treat assigned unarchived unclosed leads as 可设计, skip surveying-editor and **应用到哪里**, and create a lead-bound `rough_sketch` workflow; floor-plan recipes still intercept 待量房 and require `eligibleFloorPlanId`. Then pick or create a scheme from `GET /api/miniprogram/ai/studio/workflows`, then **应用到哪里** for floor-plan recipes only) → `recipe-confirm` (continues that scheme; photo mode chooses 拍照 / 相册 / 本户现场图, new captures pick a room tag then store on the lead gallery and reuse that `assetId`) → `scheme-studio`. Selecting an existing scheme adds another round to that conversation; **新建** creates a named workflow like Admin. Scheme cards on that picker use a stable display cover of the latest confirmed image (platform `directQiniuDisplayUrls` switch: Qiniu by default, aligned signed API when off), otherwise the latest succeeded generation, and keep the folio placeholder only when the conversation has no generated image. `recipe-project` then defaults to **完整户型** (`targetScope=whole_floor_plan`) and lists the scheme-bound plan's closed survey rooms as **单房间** (`single_room` plus `roomId`, name and size from `GET /api/miniprogram/ai/studio/workflows/[id]` `sourceFloorPlan.rooms`); helper copy states the recipe applies only to the current selection, without generating other rooms or extra credits. Those `targetScope`/`roomId` values are the same space semantics as Admin AI workbench batches via `resolveMiniAiFloorPlanTarget` and `input.roomData`. `scheme-studio` is the **scheme archive and continuation** whose composer apply-to picker (**户型** tool +「出图设置」) posts the same `targetScope`/`roomId` as Admin. Model chips use `GET /api/miniprogram/ai/studio/bootstrap` `models` (the same executable GRS catalog as Admin: catalog-enabled plus at least one enabled credit price; preselect uses `provider.defaultRemoteModel` from the image-provider mapping when present, else `isDefault` then weight; mapping is default display only; `free_create` submits the catalog snapshot `remoteModel`). The Design tab header no longer exposes **设计记录**; `ai-design-history` remains as an overlapping task log (`GET`/`DELETE /api/miniprogram/ai/history`, plus Admin `/api/ai/history` and `ai_generations`). Isolated-task results still offer **查看历史**. Weakening this entry does not change the recipe path. Deep links from `lead-detail` / `index` / `pendingAIDesignContext` carrying `leadId` (plus optional `floorPlanId`/`workflowId`) open `packages/ai-workflow/scheme-studio/scheme-studio` via `openAIDesignEntry` (or the Design tab's pending-context handoff). Recipe confirmation kicks off the task then redirects into scheme-studio when a lead workflow exists; isolated tasks without a workflow still use `ai-design-result`. History cards expose **进入方案** for synced workflow tasks. Customer/project picker, result/history (legacy single-image publish remains for isolated tasks), lead-scoped scheme publications, and the scheme-studio deep page (`GET /api/miniprogram/ai/studio/*` workflows/tasks/composer/publish) remain available. The static role Tab no longer occupies `pages/ai-design/ai-design` as a measurer entry; the enterprise-owner appointment schedule no longer occupies this shell and opens `enterprise-appointments` | Implemented/Limited; provider, credit, formal-survey eligibility, lead responsibility, publication visibility, and workbench scope are server controlled. Mini Program recipe and create tasks persist scoped `roomData` through the same helper as Admin batches, but `floor_plan_render` still attaches the whole-plan survey-canvas PNG as the control image (`resolveFloorPlanControlPng` without `roomId`); room-cropped control images remain Limited on this channel. Mini `scheme-studio` continuation posts `targetScope`/`roomId` from the D09 composer apply-to picker (**户型** tool +「出图设置」row, default `whole_floor_plan`, closed rooms as `single_room`). The composer reference row locks a **控制图** thumbnail of that scope (the same crop the batch uploads first). `scheme-studio` restores D09 (`45-ai-scheme-studio.jpg` / `45b-ai-scheme-studio-templates.jpg`): explicit **切换方案** nav action + chips, project-card merge-send CTA, 24rpx gutter between the project card and empty-round card, theme-green `#00c365` composer credit bar with white copy, merged rounds with published badges, Creation-aligned composer (model/count/aspect/resolution, references, cover-grid templates via imported HTTPS covers (Roomi COS) when present, otherwise signed Mini recipe-preview URLs, prompt assist, 4s polling, retry; collapsed generate FAB stays inside the dock), merge-publish modal (first send and update both edit the scheme name and sync the workflow title with the customer-visible album title; confirm Cancel/primary actions wrap native `button` in flex cells so they stay inside the sheet with bottom safe-area padding), **设为定稿** beside the published banner (reuses the confirm-dialog pattern; finalized banners read **客户可见定稿**), rename/delete workflow, delete generation, and single-image withdraw. Opening with `leadId`+`floorPlanId` but no `workflowId` reuses the preferred existing lead scheme (same floor plan, then highest `generationCount`) instead of minting an empty conversation. Opening with `leadId` only bootstraps a lead-bound `rough_sketch` conversation; without a bound floor plan the composer hides the **户型** tool, batches omit `targetScope`/`roomId`, and sending to the customer does not require a completed survey. AI workflow Less surfaces follow the raised typography floors (helpers ≥`22rpx`; `20rpx` only for tertiary badges) and are guarded by `miniprogram-typography-floor`. Mobile Limited: no Admin canvas annotation editor (continue-as-reference only), no dark theme toggle, and nine-stage `proposal_pack`/`lighting` stay on existing admin_handoff paths. Authenticated `390x844` native-capsule visual QA for D01/scheme-studio is deferred to owner local verification |
| Mine and account | `pages/mine/mine`, `packages/business/login/login`, `packages/business/legal-webview/legal-webview`, `packages/business/profile-edit/profile-edit`, `packages/business/settings/settings` (compatibility deep link; content merged into the Mine Tab), `packages/business/identity-switch/identity-switch`, `packages/business/identity-recovery/identity-recovery`, `packages/business/account-security/account-security` | Account security, WeChat system permission settings, and server-backed identity-context selection; the login page keeps the approved agreement row as a larger hit target that toggles `agreed`; WeChat `getPhoneNumber` is mounted only after that box is checked so the native button cannot steal the tap or authorize without consent. Phone authorization prefers the WeChat dynamic `code`; older clients that return only `encryptedData`/`iv` are accepted on login, onboarding, open-account, and anonymous claim. Those pages prefetch `wx.login` before the tap and send that cached login code with the ciphertext so the server can decrypt with the matching `session_key`; they must not call `wx.login` again inside the `getPhoneNumber` callback. Tapping《用户协议》/《隐私政策》`catchtap`s into `legal-webview` with hosted https pages `https://smartfloor.zlyun168.com/user-agreement.html` and `https://smartfloor.zlyun168.com/privacy-policy.html` (`utils/legal-docs.js`). 《免责协议》 remains in `legal-docs.js` and the hosted `disclaimer.html` page, but is hidden on the login agreement row for now. `listContexts` returns every active staff row for the WeChat user (stable `staffId` ascending order), not only the first; `GET /api/miniprogram/bootstrap` returns the current role, valid role groups, enterprise/membership context, landing path, capability allowlist, and a server-owned badge summary of role-scoped todo counts. Switching exchanges a signed context token; login, onboarding, claims, switching, and startup recovery refresh and validate bootstrap before shared identity navigation enters a signed landing. `identity-navigation` rejects unknown identities and forbidden deep links; an invalid signed context enters the recovery page, clears its old session, and requires reauthentication Mine now shows the native `Role guide` account row when any of the account's valid identities (`bootstrap.roles` / identity-contexts) has an approved guide, including while the current signed identity is customer; `referrer`, `enterprise_admin`, `designer`, and `measurer` currently qualify. The current role opens directly when it has a guide; otherwise Mine replays the held work identity (native ActionSheet if more than one). A customer-only account still has no row and no unapproved placeholder. | Implemented/Limited; visitors see the approved full-height, capsule-safe JoveKore｜家客来 gateway with the standalone packaged doorway scene, the native `个人用户 / 员工 / 推荐人` identity rail, and one executable login CTA; this denser logged-out composition changes no route, API, or permission boundary. Unsigned visitors reuse the customer `Service/Mine` TabBar so Service home stays browseable; login stays the Mine CTA. Only bootstrap-backed or stored signed roles generate capability-allowlisted navigation: customer `Service/Mine`, referrer `Promotion/Customers/Earnings/Mine`, designer `Workbench/Data/Customers/Design/Earnings/Mine`, measurer `Workbench/Data/Customers/Earnings/Mine`, salesperson `报备/Mine` (promotion-records + mine; not the designer/measurer role-workbench shell), enterprise owner `Workbench/Operations/Customers/Commissions/Mine`, and platform admin `Devices/Review/Mine`. Salesperson Mine loads `GET /api/miniprogram/mine` as a staff dashboard (新建报备 / 公海 / 我的提成) and is not treated as a customer/referrer restricted shell. If a salesperson hits `pages/index`, the home page `reLaunch`es to promotion-records. Server-provided Mine actions now use `referrer.network`: designer, measurer, and salesperson show **我的推广人 / 邀请并查看我的推广人**, while the enterprise owner shows **推广网络 / 查看员工分支与全部推广人**; each enters the existing `enterprise-referrers` deep route. A signed `platform_admin` on `pages/index` `reLaunch`es to `packages/platform/devices/devices`. Signed `platform_admin` Mine uses the role-shell staff profile plus permission/account rows (including **出示开户码**) and does not render the legacy **我的空间档案**, **我的户型**, or **开始量房** archive. The shared custom TabBar uses matching neutral/active `tab-earnings` assets for Earnings and Commissions and the packaged `operations-dashboard/chart.png` icon for the enterprise-owner Operations item; native `tabBar.list` includes `pages/enterprise-operations/enterprise-operations` so that tap uses `switchTab`; it paints server badge counts and shows `暂时无法读取` when the summary is unavailable. The signed Mine Tab no longer offers subscribe authorization (no「订阅任务通知」row and no login/onboarding/claim subscribe modals); it keeps a「权限」section with WeChat permission management (`wx.openSetting`), plus an「账号」card with「编辑资料」(opens `profile-edit`), current identity (two-line workbench switch-identity helper「在个人用户、员工和推荐人身份之间切换」), account security, and logout below the profile card; the header no longer hosts the compact「编辑资料」chip; the referrer workbench no longer duplicates identity switch or logout; the header settings gear is removed and the `settings` route only `switchTab`s back to Mine for deep-link compatibility. Referrer/customer profile cards refresh `/api/miniprogram/profile` from the signed context; `profile-edit` saves nickname plus optional avatar via `POST /api/miniprogram/profile/avatar` (normalized JPEG, signed delivery URL; `.example.com` `MINIPROGRAM_API_PUBLIC_ORIGIN` placeholders fall back to the request host). Designers can also self-serve their WeChat ID and personal QR on `profile-edit` (uploads accept PNG/JPEG including empty/octet-stream MIME and store PNG, without QR-content decode; the QR picker is a `view` that hides the keyboard before `chooseMedia` so filling 微信号 first does not fail the upload; the page shows ready/incomplete status; an incomplete designer workbench prepends an `action: profile` todo into `primaryItems`, and every workbench entry while incomplete also queries `GET /miniprogram/staff/wechat-profile` and shows a `wx.showModal`「请先完善微信资料」with「去完善」into `profile-edit` when `assignmentEligible` is false (QR-only or ID-only still prompts; period refreshes do not re-prompt)). Focused layout and account-menu regression tests pass. Revocation, deactivation, and version changes expose no invalid-tenant data and never silently fall back to customer |
| Recommendation share | `packages/business/recommendation-share/*` | Read-only shared recommendation and project summary | Limited by share authorization and available assets |

Identity-switch visual treatment: `packages/business/identity-switch/identity-switch` follows the approved card-grid reference `design-references/identity-switch-card-grid-v2/identity-switch-card-grid-v2.png`. It uses native layout only: a compact single Xiao K archive-manager preview for the locally selected context, then a two-column card grid and the existing confirmation CTA. Every role label, including `家装设计顾问` and `家装现场顾问`, is native text and remains fully readable rather than using a horizontal rail or ellipsis. The selected card has a green outline and `当前使用` state; independent transparent role-tool PNGs in `packages/business/assets/identity-switch/role-cards/` identify `customer`, `referrer`, `enterprise_admin`, `designer`, `measurer`, `salesperson`, and `platform_admin` without slicing the approved composite or repeating Xiao K on every card. The disabled current-identity CTA uses an opaque mint fill, green border and dark-green text to remain distinguishable from the page background. Tapping a card previews it locally; only a non-current selection exposes the existing native confirmation and signed-token switch. A single valid context shows the preview but no meaningless switch action. The existing `GET /api/miniprogram/identity-contexts` / `POST /api/miniprogram/identity-contexts/switch`, route, and permission boundaries are unchanged. Unsupported legacy roles retain the customer-guide fallback and do not gain capabilities.

### Lead-detail referral marker

`packages/business/lead-detail/lead-detail` consumes the already returned, authorization-scoped
`GET /api/leads/[id]` `referrer.displayName`. When a referral-network attribution exists, its
native Hero displays **推荐人：姓名** flush to its lower-right edge, using the existing green
formal-survey tab treatment; no list scope, endpoint, role boundary, or navigation changes. The marker is absent
for leads without a referrer. Focused layout tests cover the data binding and shared visual
geometry; native `390x844` capsule-host verification remains pending the user's manual screenshot.

## List pagination

Unbounded Mini Program lists share `miniprogram/utils/list-pagination.js` (`page`/`limit`, default 20, max 50) with `createPaginationMetadata` on the matching GET. Scroll-view lists bind `scrolltolower`; page-scroll portal lists use `onReachBottom` (distance 120). Footer copy is `正在加载...` / `已经到底了` via `.sfp-list-footer`. Filter/search resets to page 1; summary chips use COUNT totals, not the current page length.

Covered: `enterprise-staff`, `enterprise-referrers` own/flat views, `referrer-progress`, `referrer-earnings`, `staff-earnings`, `enterprise-commissions` (`status`), `commission-records` (`status`), `promotion-records` (`search`), platform `enterprises` / `devices` (device rows only), lead-detail `assignable-staff`, and recipe-project `GET /api/miniprogram/ai/studio/leads`. Not paginated: the owner `enterprise-referrers?view=network` branch aggregate, `customer-projects` ranking index, workbench preview caps, identity-contexts, calendar/day appointments, BLE scan session, the devices enterprise picker, and overdue todos (`GET /api/workbench/todos`, still internally capped at 200).

### Password-login first-change reminder

`packages/business/login/login` and `packages/business/account-security/account-security` implement the current password-login contract. `/api/auth/miniprogram` returns `requiresPasswordChange` only for password-authenticated flagged staff and may still sign that flag into the token. The login page still runs normal bootstrap and role landing; it shows a one-time native `wx.showModal` reminder so the user can enter the workbench and TabBar immediately. Choosing **去修改** opens the existing account-security page after landing; **稍后** stays on the role landing. Cold start and token refresh do not trap the session or re-prompt. Mini Program APIs are not locked by this flag. `PUT /api/miniprogram/account/password` still clears `admin_users.must_change_password`; the existing page then clears local session and requires login with the new password. WeChat authorization and phone quick login do not trigger this reminder. Shared password matching reports `invalid_credentials` or, after filtering by password, explicit `ambiguous_identifier`. Existing sessions are not proactively revoked; the latest flag is acquired at token refresh or the next password login. Status: Implemented. Design source remains `design-references/miniprogram-airy-minimalist-v1/30-account-security.jpg`; the layout is unchanged and authenticated `390x844` runtime confirmation is pending.

## Platform enterprise registration APIs

The enterprise-register form now exposes an editable contact-phone input. Users may type the number, but submission still requires WeChat phone authorization and an exact match; the CTA reads **授权手机号并提交**, auto-submits after successful authorization, and keeps the form open with an inline correction message on mismatch.

`POST /api/miniprogram/codes/resolve` recognizes platform `er_` open-account tokens (including bare 32-char scenes) as `{ kind: 'enterprise_registration', displayName: '家客来企业入驻', valid: true }`. `POST /api/miniprogram/enterprise-registration` requires a Bearer JWT whose authorized phone exactly matches `contactPerson.phone`, validates the active `er_` code, and creates a `pending_approval` / `self_service` enterprise through the same `createSelfServiceEnterpriseApplication` helper as Web `/api/auth/register-enterprise`. Platform review/ops for that application live on Admin `/enterprises` and Mini Program `packages/platform/enterprise-review*` (`POST /api/admin/enterprises/[id]/status` and `POST /api/miniprogram/platform/enterprises/[id]/status` both via shared `applyEnterpriseStatusChange`: FSM, owner provision, and `enterprise_join_result` notify). Platform admins can also present the current active `er_` image from `packages/platform/registration-code/registration-code` (`GET /api/miniprogram/platform/enterprise-registration-code` and `/image`, view-without-rotate); non-`active` enterprises are not usable as Mini Program staff/referrer workbench contexts. The scan landing is not a sticky home: WeChat recents/home/desktop reopens (`1001`/`1023`/`1089`/`1090`/`1103`/`1104`) with any signed identity leave to role landing; a fresh QR scan or chat-card share keeps any signed identity, including workbench, on the form so they can apply. Custom nav reuses the claim-page back chevron (`navigateBack`, otherwise role landing or Mine) so a stack-root scan cannot trap the user. The same recents-leave and back-chevron contract applies to `ej_` onboarding and `rp_`/`sa_` claim landings. Ready/success/error/recovery still expose **去登录** as a native button that `reLaunch`s password login after clearing the incidental phone-auth customer session (Mine visitor gateway if relaunch fails); `ACCOUNT_CONFLICT` after approval is an already-account exit; phone authorization that already resolves as a workbench identity stays on the already-account state and asks with `wx.showModal` whether to leave (session hydration is pinned so it cannot steal the page); confirm goes to role landing, cancel stays so the message can be read, with password-login fallback if landing fails. Enter-scene detection uses live WeChat enter options so a hot-start scan is not mistaken for a recents reopen. Login `mode=password` does not bounce back to the scan page. On the ready form, empty required fields (enterprise name, unified social credit code, contact name) keep a mint `--action-disabled-bg` CTA that stays tappable: the page lists `还需填写：…`, and a tap highlights those inputs with inline `请填写…` copy. The contact-phone field is editable for manual entry, but the ready CTA is explicitly **授权手机号并提交**: WeChat `getPhoneNumber` validates that entry and automatically posts the registration on success; a mismatch leaves the form with an inline correction message. WeChat `getPhoneNumber` is bound only after those three fields are filled, so an incomplete tap is not a silent no-op. Status: API and `packages/business/enterprise-register/enterprise-register` Implemented; focused contract tests cover scene/`er_` restore, resolve-before-phone, missing-field hints, form-gated one-tap authorize-and-submit, phone-match submit, the login/workbench exit, a fresh QR keeping a signed workbench identity on the form, recents reopen leaving signed scan landings, stack-root back, and post-approval phone-auth prompting before leave. Authenticated `390x844` native-capsule visual QA remains pending. After platform approval the contact phone logs in as `enterprise_admin` with initial password `123456`; approval also links that phone's existing Mini Program user to the new admin account. Approval SMS and in-app progress lookup remain out of scope.

## Formal surveying

Manual clockwise/counterclockwise rotation in `packages/surveying/editor/surveying-editor`
recenters the rotated bounds of the current survey nodes and active preview point.
An empty draft retains screen-centre world-point compensation. This is view-only:
graph geometry, routes, APIs, permissions, and persisted viewport fields are unchanged.

Cloud-save contract: autosave, manual save, and completed submission share one serialized queue; only one request is in flight, and a queued `completed` request upgrades and takes priority over queued `draft` work. New floor-plan creates carry a persisted `Idempotency-Key`; the server-side unique `floor_plans.create_idempotency_key` makes a lost-response retry return the original plan instead of creating a duplicate. Once `floorPlanId` exists the client sends exactly one PUT; every PUT failure is propagated without clearing the ID or falling back to POST. POST is used only when no ID exists.

Floor-plan writes keep the formal-v4 400 envelope gate. Drafts run `quick` validation; completed plans run enhanced `full` validation and require at least one closed Space before any database write or preview generation. Invalid data returns 422 with the first error code/message plus `validation.mode/errors/stats`, and the server never repairs the submitted graph. Full validation rejects proper crossings, unsplit T endpoints, coincident endpoints owned by different node IDs, and positive-length collinear overlaps; it also requires mode-valid saved `lengthMm` / `angleDeg`, non-negative integer measurement inset/extension fields that leave positive effective measured length, and a complete integer `rawMeasuredLengthMm` / `closureAdjustmentMm` pair whose sum equals the saved length. Synthesized zero-reading `closure-merge` / `closure-bridge` connectors without a raw reading remain valid. Geometry uses integer-millimetre centerlines and the existing epsilon, never the 350 mm snap tolerance. Manual and BLE remeasurement use the same full immutable transaction. Isolated closed orthogonal cycles balance only along the remeasured wall's axis, so a later perpendicular remeasurement does not undo the first one; both open and closed remeasurement reject `OPENING_REMEASURE_CONFLICT` before moving a wall that could no longer contain its door/window. Invalid edits roll back graph, rooms, openings, history, and draft rather than auto-splitting walls or moving openings.

For an isolated orthogonal chain with no openings, shared nodes, or branches, a return-to-start residual is balanced over same-axis walls by measured-length weight. The ordinary 350 mm snap tolerance remains unchanged. A long multi-corner chain may use additional accumulated residual only when every wall remains inside a correction budget equal to 2% of coordinate length, clamped to 25–150 mm, and total residual does not exceed 1,000 mm. A short loop that would overspend one wall's budget is rejected instead of being distorted or closed with a micro bridge. Preview and confirmation use the same plan, keep segment directions and minimum lengths, include the tolerated 1 mm perpendicular straight-wall drift in the projected residual, and project the adjusted chain before offering closure; any new non-adjacent intersection, overlap, or contact with another wall rejects the plan. Confirmation stores each raw reading and its derived closure correction separately, and later endpoint inset, collinear merge, and wall split operations preserve that traceability.

Measurement audits use a local write-ahead queue: each accepted manual/BLE edit is persisted before upload, initially under a stable draft scope, then atomically moved and bound when `floorPlanId` becomes available. Loading or saving retries pending records; exceeding 500 records warns without truncation, and records bound to another plan are never sent. Embedded-component keyboard edits are batched into one final manual audit, and a pending-wall BLE commit records the real created `wallId`. The 17-byte ATD parser requires the vendor header/tail/CRC, preserves raw frame/channel/time metadata, treats distance as big-endian unsigned and angles as big-endian signed, deduplicates only identical cross-channel frames within 350 ms, and guards late app responses from becoming hardware-key readings. Closing the editor restores the prior complete BLE callback set. Uploads send canonical top-level `auditId` and retain `metadata.auditId` for compatibility; formal surveying requires a non-empty value of at most 200 characters. PostgreSQL's nullable `measurements.audit_id` partial unique index on `(floor_plan_id, audit_id)` is the final idempotency guard: a first create returns 201 / `deduplicated: false`; a repeat returns the same record with 200 / `deduplicated: true`. Existing null audit rows remain unchanged.

This stability hardening keeps every previously correct survey path and UI unchanged: snap/closure tolerances, multi-room shared walls, face extraction, wall solids, Canvas, WXML/Less, and the operator flow remain the baseline. In addition to the bounded near-close adjustment and remeasurement corrections above, the targeted corrections cover four internal-divider defects: an L-shaped divider keeps reused exterior walls on the source-room face instead of forcing `offset`; a divider continued after a short confirmed first segment stops at the first opposite-boundary hit instead of crossing the room wall; splitting a wall shared by two closed rooms freezes its already-rendered body side before cloning replacement segments, so a leftward partition cannot flip one segment by a wall thickness merely because post-sync Space order differs; and a divider that would split through an existing door/window is rejected before wall mutation instead of remapping that opening onto one replacement segment. The shared-wall correction changes only affected `bodyNormalSide` values. The opening correction reuses the existing non-layout error-toast path; centerlines, measurement faces, openings, Spaces, history, route/API/permission boundaries, WXML/Less, and persistence remain unchanged when it rejects a closure. Outward adjacent-room behavior remains unchanged.

The 4,096-case deterministic formal-closure catalog now exercises orthogonal and diagonal outlines, effective release tolerance, same-wall adjacent rooms, sequential four-room cross partitions, nearest-boundary partitions inside concave rooms, every source/divider wall-thickness pair, short manual/BLE divider continuations, safe door/window remapping immediately beside split points, atomic door/window-conflict rejection, formal save/restore, and immutable self-crossing rejection across rotations, mirrored winding, measurement sides, face snaps, and direct/committed closure actions. This adds no WXML/Less, route, API, permission, or persistence change.

Opening-split contract: before any host wall is split, every interior cut is checked against the opening's physical span plus the junction clearance of one current/incident divider-wall thickness. A touching or overlapping cut throws `OPENING_SPLIT_CONFLICT` with `分隔线压到门窗，请先调整门窗位置`; the immutable transaction returns no partial wall/node/Space/opening/history mutation, and direct release, the “合” action, manual length entry, and BLE length entry surface that message through their existing Toast. Safe placements beyond the clearance still remap to one replacement host segment without changing the opening's world position. Cross-segment openings remain unsupported; the operator must move or remove the opening before retrying the divider.

The only measurement editor is
`packages/surveying/editor/surveying-editor`, entered with `leadId`
and/or `floorPlanId`. A lead-only entry without `floorPlanId` resolves that
lead's primary cloud plan before creating a blank canvas. The authoritative contract is
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md).
`FloorPlan.layoutData` contains only version-4 `surveyGraph` data. Completed
`POST/PUT /api/floorplans` of a formal v4 plan persist a `surveyCanvasRenderer`
PNG snapshot on `floor_plans.preview_asset_id` and never into `layoutData`. Wall graph,
Canvas renderer, dimensions, BLE readings, audit queue, undo/redo, the
right-rail confirmed canvas-clear/restart action, and save failure behavior
must follow that contract. The dock 测距 action writes a BLE reading onto a
pending wall preview or a selected wall; the meter's hardware measure key
sends the same 17-byte ATD frame and uses that same write path without a second
dock tap. Tapping 测距 or receiving a hardware ATD before a wall is dragged
toasts「请先拉出一条墙」instead of asking to open numeric edit. The top-bar back
control is an 88rpx cover-view painted after the centered title overlay so the
title layer cannot steal the tap. Successful top-bar Save (`onSaveDraft`) persists the
draft then navigates back; cloud failure stays on the editor. Page `onHide`/`onUnload`
immediately flush the local draft and silent-save the v4 graph to the cloud; a newer
local draft wins over a stale cloud copy on reopen. Closed `spaces` written by `confirmClosure`,
`deleteWall`, and closed-wall splits come from half-edge faces; the same
transaction rejects the edit if saved spaces and extracted faces diverge.
`deleteWall` (and remasure complete / cancel-pending) clears remasure
`session.fixedNodeId` so a deleted free tip cannot leave a stale session node
reference. Door/window width is clamped to the current host wall length (minimum 100 mm), not a 60% wall-ratio cap. Tap hit order is opening → wall → closed-space interior; selecting a
closed room sets `selectedSpaceId`, paints blue fill/stroke with internal clear
dims, and switches the right rail to rename (`renameClosedSpace`) / delete
(`deleteClosedSpace`, exclusive walls only; shared walls kept).
The persistent top-bar CAD action is disabled until the cloud plan is
`completed`; it downloads through `GET /api/miniprogram/floorplans/[id]/export/dxf`,
which reuses Mini Program floor-plan access control and the same formal-v4 /
closed-space validation as the Admin endpoint. The file uses Chinese CAD layers
and millimetre DIMSTYLE. Walls are unioned inner/outer `LINE` faces with
opening jambs, not per-wall thickness rectangles. Hinged doors insert a `DOOR`
block on the opening face with an open 90° thick leaf, gray dashed arc, and 50mm jambs;
sliding doors stay double rails and windows use four inset in-opening lines away from the wall faces.
Dimensions are rotated linear entities from the shared closed-space plan
(`标注线-内墙` inner segments including wall-thickness ticks, `标注线` overall
lengths, `DIMTAD` 2 / `DIMGAP` 10; recessed L-notch spans stay local). Closed rooms write four-line
MTEXT (`\P` breaks) from the inner-face polygon. A cyan full-height right
title panel and yellow north arrow wrap the side-by-side floors. Company sits
at the top of that panel. Company and designer come from the linked customer
lead; customer phone and address are omitted. The app saves the DXF to its
file domain and opens the system document handler; an unavailable DXF handler
shows a transfer-to-CAD-device prompt. The file is generated on demand only.
Graph nodes stay on the centerline; working faces and one-sided bodies are
read models. Deleting a wall shared by two closed rooms punches
through that interface and merges them into one closed room, including when the
shared run has been split into collinear segments. A merged inner dimension
plan must remain defined after collinear inner corners collapse. A punch-through
L corner keeps rectangular wall solids and must not convex-miter into the room.
Node joins use local convex/concave predicates (outer miter, overlapping inner
rectangles, outer-only opposite-thickness steps); Admin
`surveyWallSolidPlan.js` uses the same generator. Inner-face punch-through keeps each remaining wall's original body side: the
inner L extends into the merged room, opposite-thickness collinear walls stay a
stepped facade and fill the outer step corner so inner faces stay aligned, and the two remaining
walls keep overlapping rectangular solids instead of a convex-mitered trapezoid.
Partitioning either side of a two-room shared wall freezes the wall's current
physical side before splitting it. All replacement segments with the same
`topologySourceWallId` inherit one `bodyNormalSide`; post-sync Space ordering
cannot flip only one segment. Left/right partitions remain mirror-equivalent,
and the untouched room keeps the same render boundary, net area, and clear dims.
Closed exterior-wall T branches retain one topology node and physical wall.
An inferred orthogonal close absorbs a collinear continuation into the last
measured wall rather than leaving a butt joint. Two new walls started from a
closed-room corner close against the existing boundary when the second wall
lands on an adjacent wall and completes a face with the start edge; axis
alignment to a distant corner without hitting an existing wall still does not
infer extra closing walls. Loading a saved draft also
folds remaining collinear degree-2 splices into one wall. Deleting a wall that
opens a single closed room restores the remaining loop as the active chain and
offers the missing-edge close when the dangling ends still determine it.
Resetting the cursor onto either dangling vertex resumes that same open chain.
Confirming a closed room automatically enters the same reset-cursor / wall-drop
state as tapping 重置光标, so the operator can drag the dock cursor to the next
start without a second tap. The formal canvas cursor and both dock states
(重置光标 / 光标拖动到墙体) use the same Fig.1 green reticle glyph
(`drawCursorGlyph` + `icons/cursor-reticle.png`). Dock wall-drop drags aim that
reticle 24×40 CSS px upper-left of the finger and clamp the aim point to the
canvas; snap, the corner magnifier, and release all use the aim point, not the
finger pad. Dock input uses a 16 ms leading/trailing latest-point queue instead
of dropping intermediate touchmove updates. One placement index per stable
formal scene reuses visible vertices, inner/outer wall segments, and closed-room
alignment axes. Free-follow frames skip the full snap search and dirty-clear
only the reticle; retained wall/alignment locks slide continuously on the same
target while vertex locks stay fixed, using the existing 16 px acquire / 26 px
release hysteresis. Magnifier crops remain low cadence, and retained snap frames
no longer full-clear the overlay. Canvas wall-endpoint drags keep a sticky grab delta from
touchstart and a south-east-biased hit (`surveyCursorAim`); they must not apply
the dock offset, so the first preview frame cannot invent a wall. The drag magnifier overlays a small green
crosshair at its centre and does not magnify that glyph. During that wall-drop wait (`wallSnapPending`), the
canvas still pans and pinch-zooms. Its lightweight gesture frame keeps the current green reticle visible at the same transformed plan coordinate with a stable screen-space glyph size, providing a continuous zoom reference. The projector can apply a page-level view-only `rotationRad` that is never persisted. A persistent canvas compass (`survey-canvas-compass`) toggles four-cardinal heading follow outside BLE input mode; direction changes perform a full scene redraw. Heading follow and BLE automatic direction pick use `surveyDeviceOrientation.sharedHeadingSensorHub`, preferring Compass and falling back to DeviceMotion, while the phone-angle sheet keeps `sharedDeviceMotionHub` for beta/gamma. Both heading subscriptions pause on `onHide`/`onUnload` and resume on `onShow` when their logical modes remain enabled. Straight-mode BLE quick input keeps blue dashed cardinal guides visible from the first wall and draws three or four compact, single-layer, translucent-green candidate pointers, excluding the active chain's backtrack. Once a bearing is selected, all other candidates disappear and only a small blue arrow remains on that direction's guide; tapping otherwise empty canvas space clears the transient bearing and restores the candidate pointers without moving the cursor or changing walls. The wall is still committed only after a valid BLE distance. Automatic pick waits for privacy authorization, maps Compass cardinals into canvas cardinals after removing view rotation, uses circular median plus activation/switch hysteresis, and rearms after each wall so an unchanged heading can select the next wall. Its `bleLockedBearingDeg` is transient and is stripped from local/cloud graph serialization. Dimension labels use world wall angle plus view rotation (`resolveScreenEffectiveAngle`); room cards stay screen-axis aligned; the grid rotates with the plan. Graph geometry, ortho snap, BLE protocol semantics, route/API/permission boundaries, and persisted viewport data are unchanged; a wall tap only selects the wall for opening
placement, while the cursor is placed only by dragging the dock control onto the
canvas. A short tap on a closed-room fill selects that space during the same
wait (`selectSpace`); the wall/vertex toast appears only when neither snap nor
fill hits. In guide mode that reset-cursor state immediately
shows the Xiao K place-next-start tip even when closed-room dimension labels
fill the canvas; the dock-guide layout softens or force-places rather than
hiding the tip, and `closing` / `mergeClosing` keep the BLE direction
candidates visible alongside the `合` close action.
Inner/outer start selects the near/far point on the source boundary and the
corresponding first-wall inset; it does not choose opposite local faces for the
new branch. Every branch segment uses the graph-side working face and inherits
the physical-body side fixed by the first segment. An explicit first-wall
measurement-position toggle on a shared-boundary chain moves the red measuring
edge to the opposite face while keeping that inferred occupancy; later drags
must not overwrite that choice. Turn direction and the
source-space centroid cannot re-evaluate that side. Orthogonal touch input stays
on the internal graph, while the preview outline, orange/red path,
live-dimension endpoints, and green cursor remain coincident. Straight-mode
vertex, closure, or outer-face snaps may change at most one axis and must not
copy an off-axis vertex or wall-thickness offset onto the orange preview. The
physical outer face remains the contact/closure target while confirmation uses
a short orthogonal bridge for any remaining off-axis gap; the wall-drag lens reports the actual
snap type and shows a small green crosshair rather than the canvas Fig.1 reticle,
following the sticky grab aim point rather than a dock-style finger offset. Adjacent red edges
meet with equal endpoints, so beginning a second segment cannot shift the cursor
or red line by one wall thickness. Measurement inset/extension fields record
real boundary or closure adjustments only; an ordinary outer-start T turn does
not synthesize a wall-thickness adjustment. Preview, manual/BLE confirmation,
Canvas, and dimension consumers consistently calculate `topology length - start
inset + start extension - end inset`. Closed-room Canvas dimension lanes omit per-room clear spans (`room-clear`)
unless a closed space is selected (`session.selectedSpaceId`); then that room
gets a blue selection fill/stroke and internal clear dimensions, and the right
rail shows rename (`renameClosedSpace`) plus delete (`deleteClosedSpace`,
exclusive walls only). Selected-state `room-clear` merges collinear end-to-end
`innerSegments` into one continuous clear label per side so a neighboring
T-junction that splits one physical edge into multiple graph walls does not
fragment those dims; `building-overall` and `space.wallIds` stay unchanged.
Unselected rooms keep building-overall bands plus door
positioning / wall-thickness ticks, keep recessed L-notch spans on the local
face, and sit outside every unclosed wall on the canvas plus a stationary length
preview; an in-flight `wallPreview` drag does not move those lanes. Closed wall
solids always retain topology endpoints so an adjacent-room T does not leave a
wall-thickness notch on the outer face. A door or window mask cuts only the host
wall and paints overlapping adjacent bodies back, so a door against a T or L
junction cannot punch a hole through the neighbouring closed solid. This derived Canvas projection does not
change graph centreline/closure topology. From the second branch wall onward,
turns may
join the rendered wall solids but cannot rewrite preceding measurement insets
or shorten confirmed readings. A shared-boundary closure
chain retains its rendered body side when it closes,
including an exterior-facing chain whose final orange line snaps to an existing
room's inner face; the close operation cannot flip that body across the aligned
line by one wall thickness. A new wall aligned to a neighbouring closed room's
visible outer keeps that outer as its working face on close and must not
extrude another thickness. When the final cursor targets a source wall's
visible outer face, it retains that physical outer coordinate and bridges to
the topology corner instead of projecting it to the centre line. The same rule
applies when a straight close overshoots by one wall thickness: preview and
`commitPreviewLength` keep the wall on one axis, and `confirmClosure` attaches
with a short orthogonal bridge (`closure-bridge`) instead of yanking the last
wall onto an off-axis topology corner (which would draw a diagonal seam inside
the shared wall body). Corner
continuations and shared internal partitions keep their existing closure behavior.
Leaving an existing T/cross vertex along a room edge keeps the original axis on
the first drag frame even while the pointer is still inside a neighbouring
miter/outer-face capture band; the reticle and preview cannot jump by one wall thickness.
An internal divider also remains clamped to its source closed room after a short
first segment has been confirmed: continuation preview stops at the first
opposite-boundary hit and closes there instead of crossing the wall. The focused
cursor-placement regressions cover both the user-provided T-vertex right-drag
sequence and the one-drag versus continued-drag boundary sequence; manual device screenshot verification remains pending, with no
WXML/Less, route, API, permission, or persisted-schema change.

## Shared APIs and utilities

### Shared Less utilities

The Mini Program uses the WeChat DevTools `less` compiler plugin configured in
`miniprogram/project.config.json`. All page and component styles are `.less`
files; `app.less` imports `styles/utilities.less` globally. New WXML should
reuse the shared layout, sizing, typography, color, radius, button, and status
classes (for example `flex-row flex-1 justify-between gap-8`) instead of
duplicating primitive declarations. Route-specific visual rules remain in the
route's own `.less` file. The compiled runtime still receives standard WXSS.

- Appointment ownership update: Service home and the customer project folio now expose the automatically assigned measurer independently from appointment state. After measurer assignment, a customer-owned lead without a confirmed appointment can enter `appointment-booking` and create the first slot through `POST /api/appointments`; the assigned designer can still book on the customer's behalf. Both share one active appointment, and the later create receives `appointment_already_exists`. Server availability, ownership checks, and automatic measurer replacement remain authoritative.

- Authentication/context: `/api/auth/miniprogram`, `/api/miniprogram/bootstrap`,
  `/api/miniprogram/identity-contexts`,
  `/api/miniprogram/identity-contexts/switch`, and the shared context resolver.
  Phone login (`type: wechat_phone`) accepts WeChat `phoneCode` or older-client
  `encryptedData`/`iv` decrypted with the pre-tap `loginCode` session_key.
- Staff workbench: `GET /api/miniprogram/workbench` accepts `period=week|month|year|custom`
  plus optional Shanghai-calendar `from`/`to` (`YYYY-MM-DD`, inclusive) for custom ranges.
  `schedule=1` range-filters owner `appointments` by that same window (tstzrange overlap, cap 500 rows / 366 days) for the appointment schedule page; the default workbench snapshot stays the unfiltered 20-row list.
  On that schedule page, custom dates render after the 自定义 chip, not in the nav subtitle.
  The Mini Program custom-period sheet keeps **取消**/**确定** above the custom TabBar.
  For all three professional roles, `pages/index/index` is the shared **工作台** and the response includes
  server-owned `activityCode`, `joinCode`, and `referrerRoster` entries. Employee join-code copy is **仅推荐人**
  and its roster entry is **我的推广人 / 仅查看本人网络**; the existing downstream APIs still force own scope.
  `pages/enterprise-operations/enterprise-operations` is the same native registered page for owner **经营** and
  employee **数据**. Owners keep the full-store dashboard, `contractAmountSum`, and `contractAmountTrend` under
  `enterprise.operations`. Designers and measurers enter through `staff.data` and render exactly five personal
  dashboard facts with no amount or store-wide copy. The owner TabBar remains **工作台 / 经营 / 客户 / 提成 / 我的**;
  designer is **工作台 / 数据 / 客户 / 设计 / 收益 / 我的** and measurer is **工作台 / 数据 / 客户 / 收益 / 我的**.
  Native `tabBar.list` remains at five registered pages and all three custom-tab entries use `switchTab`.
  Response also includes `period`, `dashboard`,
  `signedCount`, and `signingRate` (`converted` count via `convertedAt` ÷ same-window
  new leads; `null`/`—` when the denominator is 0). Hero `待交付` counts unarchived
  designing-group leads with no customer-visible publication; publishing a scheme or
  marking converted removes the lead from that snapshot. On the designer overview, the three longer
  Hero summary label/value pairs stack vertically in the left lane; owner and measurer summaries retain
  their approved single-row layout. Period `已签约` remains
  windowed `convertedAt` conversions.
  Context lists are always read from the database; a switch cannot assert an
  enterprise, staff identity, or referrer membership that is not active.
  `app.js` refreshes the signed token on startup/resume and uses one role-landing
  helper; a 401 or `contextVersion` mismatch clears local session state without
  falling back to an incorrect role.
- Referrer network: enterprise join-code PNG/JPEGs open the dedicated onboarding
  route, which resolves only the opaque token type before phone authorization.
  The onboarding and anonymous-claim scan landings reuse the claim-page back
  chevron so a QR/share stack-root can leave; a later recents/home reopen with a
  signed identity is not sticky, while a fresh QR scan or chat-card share stays
  on the form.
  After a referrer authorizes their phone, the page requires a real display name
  before `POST /api/miniprogram/onboarding/referrer` writes the membership;
  the API no longer falls back to `推荐人`.
  A personal referrer join code carries the signed employee inviter on the server;
  the resulting membership remains owned by the enterprise while recording that
  first successful inviter and a name snapshot. Re-scanning a different employee's
  code for an already-active same-enterprise membership is idempotent and never
  reassigns it; this slice exposes no reassignment operation. Historical memberships
  migrate to the owner only where the enterprise has exactly one `enterprise_admin`,
  otherwise they remain in the explicit unassigned branch.
  Active memberships are capped by platform `referrerMembershipLimit`
  (`membership_limit_reached`) and optional enterprise
  `referrerAdditionalEnterpriseLimit` (`referrer_protection_limit`); already-joined
  scans stay idempotent, and tightening N or M does not exit existing members.
  Recovery copy for the protection code is shown in the existing design-17
  subtitle without changing the recovery layout:「该企业已限制推广人同时服务其他企业的数量，暂时无法加入。」
  Global-limit recovery copy remains「当前微信的推荐人企业数量已达上限，请先退出不再服务的企业。」
  The success-state「进入工作台」CTA relaunches via `getRoleLanding` using the
  hydrated bootstrap/userInfo identity (with selected `staffRole` as fallback for
  staff joins); a missing landing path shows toast feedback instead of a silent
  no-op.
  `POST /api/miniprogram/onboarding/staff` creates the designer/measurer account
  with initial password `123456` (same constant as newly provisioned
  `enterprise_admin`); later password login uses the authorized phone.
  Enterprise onboarding, referrer-promotion, and staff-activity code generation
  use the global platform-selected environment. `develop` and `trial` use
  `getwxacodeunlimit` with the matching `env_version`; `release` uses
  `getwxacode`. The 32-character `scene` carries the token digest and
  the onboarding page restores the `ej_`/`rp_` prefix before resolution
  and then uses the existing onboarding API. Recovery「扫描新邀请」parses
  WeChat Mini Program-code `path`/`result` (including the `.html` suffix
  returned for `WX_CODE`), reapplies the `ej_` token on the current page, and
  re-resolves instead of `redirectTo` the same route, which does not reload.
  `onShow` reapplies only when WeChat changes the page `scene`/`token`, so a
  camera scan cannot be overwritten by the original launch options. The promotion display route loads
  a protected WeChat Mini Program code for the current referrer membership.
  Custom-nav presenters (`promotion-service-code`, `staff-activity-code`,
  `enterprise-join-codes`) reuse the claim-page capsule-safe back chevron:
  `navigateBack` when a previous page exists, otherwise `navigateToRoleLanding`
  so stack-root custom-nav landings can return to the role home. The promotion
  presenter now shares the activity-code intrinsic mint-poster scale
  (`staff-activity-code-fullscreen-v1.png`: nav `36rpx`, title/subtitle `64/30rpx`,
  QR `478/450rpx`, Xiao K `260rpx`, benefits `92/26/22rpx`) while remaining
  anonymous (no enterprise name). Staff-activity and dual
  join-code presenters use
  `design-references/enterprise-code-presenters-fullscreen-v1/`: each follows
  the measured intrinsic card and white-space rhythm, with protected QR, newly
  packaged route-specific Xiao K/business PNGs, truthful supporting facts,
  safety copy, and its real CTA in one continuous path. The promotion presenter
  reuses the same `code-presenter-v3` scan-guide and benefit artwork. `open-type="share"` still says
  「分享给客户」for the claim-route token target; an active join code still exposes
  「一键分享」into `onboarding` with the current `ej_` token.
  The `referrer.network` capability opens both `enterprise-join-codes` and
  `enterprise-referrers` for active enterprise owners, designers, measurers, and
  salespeople. Owners see the enterprise staff-code tab plus **我的推广人入驻码**;
  ordinary staff see only that personal referrer-code tab. Personal generation,
  image, rotation, disable, and share are forced to the signed staff scope, while
  staff-code operations remain owner-only.
  `GET /api/miniprogram/enterprise-referrers` server-forces ordinary staff to
  `scope=own` and paginates only their invitees. Owners receive `scope=enterprise`:
  **推广网络** uses `view=network` for summary-only employee branches (including
  zero-referrer employees) plus an optional historical-unassigned branch; it never
  expands a staff member's referrers inline. Tapping a real staff branch opens
  `packages/business/enterprise-referrer-branch/enterprise-referrer-branch` and
  requests owner-only `view=staff&staffId=…`; the server validates that staff member
  belongs to the current enterprise and has an eligible role, then applies
  `query`/`status`/`page`/`limit` to that one staff roster. **全部推广人** keeps the
  enterprise-wide `query`/`status`/`page`/`limit` pagination. Only owners may call
  `POST /api/miniprogram/enterprise-referrers/[id]/disable`; disable is idempotent,
  has no re-enable, and does not change historical leads or commissions. Ordinary
  staff see a read-only **我的推广人** list plus the personal-code invitation CTA.
  Disabled/exited cards keep the packaged phone glyph on the number line; every
  branch card exposes **查看推广客户**, while active owner cards also retain
  **电话联系** and **停用后续扫码**. **查看推广客户** writes
  `app.globalData.pendingLeadReferrerFilter` and `switchTab`s to
  `pages/leads-management/leads-management`; Mini `GET /api/leads` accepts
  `referrerMembershipId` (tenant membership validated, AND staff visibility).
  The customer Tab shows a clearable filter chip; leaving the Tab and returning
  without a new pending filter clears it automatically.
  The anonymous claim route
  classifies and audits opaque tokens and issues a short-lived pending source
  without creating a lead, then lands the customer on the phone-authorization
  state (skipping the historical confirm screen). That phone-auth hero never
  renders a renovation-company name for referral or staff-activity scans; the
  staff-activity presenter may still show the enterprise name. Enterprise owners may also generate and share that same staff-activity presenter; their codes stay store-level (promoter attribution plus claim/racing) and do not require a WeChat profile. When a designer
  opens the activity code without a WeChat ID or personal QR,
  `GET /api/miniprogram/staff-activity-code` returns `designer_profile_incomplete`
  (403); the page shows「去完善资料」into `profile-edit`, reloads on return, and
  lets the error-state QR stage grow while resetting native `button` width so the
  CTA stays inside the white card instead of overlapping the scan plaque on OEM
  Android WebViews. Staff/referrer onboarding, enterprise-register, login,
  referrer-workbench, free-design claim, and other native
  `button` CTAs wrap icon+label in an inner view and/or reset width/padding/`nowrap`
  so ColorOS/OnePlus cannot wrap the last character or overflow a compact chip.
  Existing in-flight attribution restores the user-approved option C continuity
  drawer with the packaged `xiao-k-continuity-archive-drawer.png`, a compact
  three-stage service path, native archive tabs, the sole filled archive CTA,
  real designer proof, and an in-flow retention note; its content is scrollable
  normal flow rather than a bottom spacer. The stage index derives only from
  existing lead status/service-stage labels. That page
  hydrates `GET /miniprogram/customer-projects/[leadId]`
  `data` (not the API envelope) so an assigned designer's `wechatId`/`wechatQrUrl`
  can enable the compact「查看微信」action, and the resolve existing-attribution lead includes
  `createdAt` for the last-update label. Staff/referrer onboarding ready and recovery states restore
  designs 16/17 with door Xiao K crops. Customer
  authorization with `Idempotency-Key` atomically creates the active attribution,
  lead, and assignment; concurrent or repeated scans cannot replace an open
  project. Phone-authorized users can
  join one staff enterprise or up to three referrer enterprises by default;
  leaving a membership disables its promotion token and invalidates old JWTs.
  `DELETE /api/miniprogram/referrer-memberships/[id]` re-signs the remaining
  usable identity: it keeps another active referrer membership when one still
  exists, otherwise staff, then customer. The promoter workbench hydrates
  bootstrap from that token and, when the signed role is no longer referrer,
  opens that role landing instead of staying on the empty promoter home.
- Customer projects, referrer progress, and design publication: `GET /api/miniprogram/customer-projects` lists only unarchived projects owned by the current `customer_user_id` and feeds Service-home featured ranking plus the multi-project switcher; the `customer-projects` page is a redirect shell only. The folio embeds **房屋现场图** (`GET/POST /api/miniprogram/leads/[id]/site-photos`, tag-first capture; native footer buttons hide while the room-tag sheet is open). The archive custom-nav back uses `navigateBack` when a previous page exists, otherwise `switchTab` to Service home so share, subscription, and redirect-shell landings are not a dead end. `GET /api/miniprogram/customer-projects/[leadId]` returns project identity fields (`heroTitle`, `navSubtitle`, `areaLabel`; archive Hero copy is fixed as `您的家装顾问` / `现场顾问与设计方案全记录` and does not render `heroTitle`), the enterprise, designer (`wechatId`, `phone`, signed `wechatQrUrl` when present, plus resolved `professionalProfile`), measurer name and `measurerPhone` (phones coalesce staff `admin_users.phone` with the linked `users.phone`), current operational appointment (active confirmed outranks expired or past-end rows), completed v4 floor-plan summary with `previewEndpoint`, `featuredScheme`, and `publishedSchemes` (images include https `imageUrl` from the same `directQiniuDisplayUrls` switch plus `imageEndpoint` fallback; named conversation albums plus an 其他效果图 bucket for Mini Program singles without a workflow; albums are ordered by first customer-visible publication via `firstPublishedAt`, so round chips stay stable after later merge updates; `publishedSchemes[].finalized` marks the finalized album, `featuredScheme` prefers the finalized workflow otherwise latest activity, and the service-archive delivery header shows **已定稿** when finalized; the featured preview overlays the style tag and visual **详情** chip on the image frame, with captions below). Service-archive「微信联系家装设计顾问」, Service-home「免费家装设计顾问」, free-design claim-success designer card, and existing-service「联系当前家装设计顾问」open a shared centered contact dialog that prefers the designer's personal WeChat QR (long-press recognize / preview) with clipboard WeChat-ID fallback and a search-add hint; claim success opens that shared dialog once after a new assignment and does not render a duplicate inline QR; after dismissal its solid-green primary enters the service archive and its secondary outlined contact action can reopen the dialog. The Mini Program cannot auto-add personal WeChat friends. Service-archive personnel cards also show the assigned designer and measurer phones when present; tapping the number (or the measurer card) calls `wx.makePhoneCall`. The green hero timeline labels the survey step `量房` so it matches the lead `survey_completed` stage without the longer “免费量房” copy. Published scheme/effect images expose stable https `imageUrl` (platform `directQiniuDisplayUrls` switch, default on: aligned-deadline Qiniu private download; off: aligned Mini Program signed API); Service home, service archive, AI folio, and lead detail bind that URL directly on `<image>` and skip `fetchProtectedImage` when present. `imageEndpoint` remains as the authenticated byte fallback for save-to-album / Admin. Formal floor-plan previews stay API-base-relative as `/miniprogram/customer-projects/[leadId]/formal-floor-plan/preview` (and staff `GET /api/floorplans/[id]/preview`); the Mini Program attaches its `/api` base URL once and still reads those protected preview bytes under the same identity, caching them under `wx.env.USER_DATA_PATH` keyed by lead + floor-plan id/`updatedAt`. A later `onShow` JSON refresh on the archive keeps already-rendered images instead of blanking them after `wx.previewImage` or returning from a child page. **Ops:** add the configured Qiniu CDN `domain` to the Mini Program request/downloadFile合法域名 list (and DevTools “不校验合法域名” for local). Customers and staff open the read-only `packages/business/customer-ai-schemes/customer-ai-schemes` folio over multi-round `publishedSchemes` (customer aggregate vs `GET /api/leads/[id]`); the page has no generate, publish, or edit actions. The service-archive featured delivery block (header plus preview, including the visual `详情` chip) navigates there directly with no action sheet. Customer save/share on the service archive and the customer AI folio opens `components/scheme-share-poster` (brand poster: scheme image + title + 家客来 logo, no mini-program code), saves to the album, then shares the image via `wx.showShareImageMenu`; both pages hide capsule page-forward and do not use `open-type="share"` / `onShareAppMessage`. Recipients who tap WeChat's image-share「打开小程序」entrance land on `customer-ai-schemes` with the same `leadId`; if they are not the owning customer, the page no longer stops on `GET /api/miniprogram/customer-projects/[leadId]` 403 and instead loads `GET /api/miniprogram/published-scheme-folios/[leadId]` (any signed Mini Program identity, platform transaction so another tenant can open the poster, published schemes plus a community/scheme hero only, no phones, appointments, or floor plans). Share viewers reuse the D08 read-only folio without the save/share CTA, and a stack-root back goes to role landing. `GET /api/miniprogram/referrer-progress` and `GET /api/miniprogram/referrer-earnings` authorize against the JWT's active membership; earnings rows follow the current commission `beneficiaryUserId` and `payableAmount` and return only masked service facts and the referrer's own commission records. `GET /api/miniprogram/staff-earnings` authorizes a signed designer or measurer and lists that user's own same-role lead-commission rows for the current enterprise. `GET /api/miniprogram/enterprise-commissions` authorizes a signed enterprise owner and lists the current tenant's unarchived lead-commission ledger grouped for phone display, with payable/paid/voided totals matching Admin `/lead-commissions`; `POST /api/miniprogram/enterprise-commissions/mark-paid` marks payable rows paid with the same repository contract and Mini Program `staff._id` as `paidBy`. The assigned designer can publish or withdraw only succeeded generations belonging to their lead, while the enterprise administrator can manage the tenant; withdrawal retains the generation but immediately removes customer visibility. Admin workbench albums use `POST /api/leads/[id]/ai-scheme-publications` with merge publishing: within the same `workflowId` the selected images are merged/updated into the existing active customer-visible publications, so the featured scheme's `published-grid` updates incrementally and unselected already-confirmed images remain visible until explicitly withdrawn/deleted; re-selecting an already-published image updates title, `sortOrder`, and `updatedAt` but does not rewrite `publishedAt`.
- Manual lead assignment: `POST /api/leads/[id]/assign-staff` accepts Mini Program JWT or Admin Cookie (not enterprise-admin-only). Body `{ designerId?, measurerId? }` with at least one id. Enterprise owners and platform `admin`/`super_admin` may fill or replace designer and measurer; the assigned designer may fill or replace the measurer only; measurers and other roles are 403. `assignLeadStaff` overwrites through `ReferralLeadRepository.assignStaff` (same-person 400, never unbinds to empty), writes `leadAssignmentEvents` (`assignment_manual` / `assignment_manual_reassign` / pending variants), and if a confirmed not-yet-ended appointment exists, rewrites `designerId`/`measurerId` with `measurementAppointmentEvents.staff_reassigned` (measurer slot conflicts return 409 after excluding this appointment). The mutation response keeps `leadToDto` staff summaries on `assignedTo`/`measurerId` (same objects as `GET /api/leads/[id]`); it does not replace `measurerId` with a string id, which Mini Program cards would render as 待分配. After a successful assign, lead-detail silently reloads GET so the designer/measurer cards show the new name without leaving the page. List and detail DTOs return `assignmentActions: { canAssignDesigner, canAssignMeasurer }`. Lead detail loads `GET /api/leads/[id]/assignable-staff?role=` (excludes the currently bound person, `page`/`limit` pagination) instead of owner-only `GET /api/miniprogram/enterprise-staff`. Admin `/leads` cards expose **分配**/**更换** through the same APIs; **重试派单** stays automatic-pool only. Converted leads may change operational staff without rewriting commission snapshots. Focused contract tests cover the role matrix, overwrite, appointment rewrite, Mini Program cards, and Admin notify.
- Staff floor-plan preview on lead detail and the shared customer list: completed
  formal v4 plans expose `plan.previewUrl` (`GET /api/floorplans/[id]/preview`);
  enterprise admins, the assigned designer, and the assigned measurer load bytes
  through `fetchProtectedImage` and open full size with `wx.previewImage` (never
  `surveying-editor`). That preview GET authorizes the linked lead's assigned
  designer or measurer (or enterprise admin), not only `floor_plans.staff_id`,
  and only when the lead and staff share an enterprise id.
  List thumbnails prefer that protected endpoint, then
  Kujiale `externalSource.previewUrl`, then CSS wall segments. Focused contract
  tests cover preview endpoint resolution and protected-image loading.
- Leads, floor plans, measurements, devices, AI, commissions, promotions, and
  notifications use their corresponding tenant-aware API families. Designer and
  enterprise-administrator AI scheme workbench reads use the Mini Program Studio
  facade under `/api/miniprogram/ai/studio/*` (bootstrap, leads, workflows,
  creation tasks/batches/retry, assets, prompt categories/templates with
  category+search filtering, cover enlarge-before-apply (prompt and recommended model only; the cover is not cloned as a reference image). User reference images on `recipe-confirm` / `scheme-studio` come from tag-first camera/album capture into the lead gallery or an existing 本户现场图 picker (selected `assetId` is used directly; no second copy). A locked **控制图** thumbnail in the scheme-studio reference row (bound whole-plan snapshot, or `?roomId=` crop matching the batch's first reference; `GET /api/miniprogram/ai/studio/workflows/[id]/floor-plan-preview` forwards that `roomId`), and a floating
  mobile-AI composer dock with a non-scrolling bottom toolbar below the prompt (**户型** / **模型** / **模板** / **设置** + generate FAB; tapping a tool blurs the keyboard before the sheet, then restores prompt focus on select or mask dismiss) and「出图设置」sheet in the scheme-studio
  template/composer surface, prompt assist, effect-image display URLs (platform `/media-storage` switch `directQiniuDisplayUrls`, default on: aligned Qiniu private download; off: aligned Mini signed API; WeChat-cacheable within the TTL window), and signed floor-plan preview URLs).
  AI design space scope is shared with Admin. The Design tab remains the
  **creation entry**; `recipe-project` follows Admin workbench selection (customer,
  then scheme conversation (cards use a stable display cover of the latest confirmed
  image, otherwise the latest succeeded generation, else the folio placeholder),
  then apply-to for floor-plan recipes: default `whole_floor_plan`, or
  `single_room` with required `roomId`; photo recipes skip apply-to); on the customer step it silently reloads
  `studio/leads` when the page is shown again (including after surveying) so a
  visit confirmed complete (`survey_completed`) moves that lead into 可设计 (`survey_ready` stays 待量房); photo recipes instead keep assigned unsurveyed leads in 可设计, skip apply-to, and bind `rough_sketch` without `sourceFloorPlanId`. `scheme-studio` is the **scheme archive and continuation** whose composer apply-to picker (**户型** tool +「出图设置」) posts the same `targetScope`/`roomId` as Admin when a formal plan is bound, and hides **户型** for photo conversations. Model chips use `GET /api/miniprogram/ai/studio/bootstrap` `models` (the same executable GRS catalog as Admin: catalog-enabled plus at least one enabled credit price; preselect uses `provider.defaultRemoteModel` from the image-provider mapping when present, else `isDefault` then weight; mapping is default display only; `free_create` submits the catalog snapshot `remoteModel`). Closed-room options come from the scheme-bound formal v4
  survey graph (`sourceFloorPlan.rooms` on `GET /api/miniprogram/ai/studio/workflows/[id]`).
  Effect images in scheme-studio bind the JSON `imageUrl` directly (`<image>` / preview / download); floor-plan thumbnails remain on the signed preview API and may still re-fetch.
  Server resolution is `resolveMiniAiFloorPlanTarget`; whole-plan cannot also send
  `roomId`, and single-room must be a closed space on that plan. Recipe/create
  persists that scope on `input.roomData` (prompt context) while still attaching
  the whole-plan survey-canvas PNG as the control image on this channel. Admin
  `/ai-studio/scenarios` and Mini studio `POST .../batches` share
  `preparePostgresCreationBatch` (whole-plan survey-canvas PNG; single-room Mini
  SVG crop with whole-plan fallback; prompt/`roomData` stay room-scoped). Mini
  `scheme-studio` continuation posts `targetScope`/`roomId` from the composer
  apply-to picker (default `whole_floor_plan`, closed rooms as `single_room`);
  the same picker remains on `recipe-project` and the Admin workbench. Appointment
  availability returns the enterprise time zone, duration, step, and maximum
  advance-day boundary; booking and rescheduling pages use that server boundary
  instead of treating a locally generated date list as authoritative. Same-day
  lists omit slots whose start is already past. When the lead already has a
  confirmed appointment, availability and reschedule ignore that row so a
  replacement can overlap the current visit; other leads still see the measurer
  as busy. Customer
  appointment endpoints derive the tenant only after the requested lead or
  appointment has been verified as customer-owned; the customer token never
  asserts an enterprise ID.
- Measurer appointment detail reads are authorized against the appointment's
  persisted `measurerId`, not only the lead's provisional `measurerId`; the
  detail request includes the selected `appointmentId` for direct lookup. This
  preserves access after an automatic measurer replacement while filtering out
  appointments assigned to another measurer.
- The authenticated measurer's `GET /api/appointments` calendar response joins
  each assigned lead's real `customerName` and `customerPhone`, so the existing
  calendar card and `电话联系` action use the same server-authorized contact.
  Customer, referrer, designer, and Admin appointment payloads retain their
  existing contact boundaries.
- Graph and Canvas sources are `miniprogram/packages/surveying/utils/surveyWallGraph.js`,
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`, and the
  surveying dimension/solid planners. The main package does not load that kernel.
- BLE integration is `miniprogram/utils/bluetooth.js`; protocol semantics come
  from the repository vendor document. In the surveying editor, a valid 17-byte
  ATD frame from the meter's measure key writes the current pending or selected
  wall the same way as dock 测距 (`ATK001#` / `ATD001#`). Enterprise connect still calls
  `POST /api/devices/verify-binding` (enterprise ownership; MAC identity is
  compared after stripping separators). iOS discovery often omits GAP `name` on
  the first packet, so scan uses `allowDuplicatesKey: true` and resolves
  `LDMStudio` from `localName`, Complete Local Name AD (`0x09`), or
  manufacturer `advertisData` ASCII. `verify-binding` also matches a compact
  advertisement hex payload against the stored MAC so an iOS UUID `deviceId`
  can still authorize. Platform enroll uses
  `scanBLEForEnrollment` (multi-device scan, MAC only, no connect) plus
  `GET/POST /api/miniprogram/devices` (batch assign via `devices[]`, optional
  `serialNumber`; list GET without `enterpriseId` returns every enterprise's
  devices, and `?enterpriseId=` remains the per-enterprise filter). The enrollment scan deliberately does not consume
  `getBluetoothDevices` historical cache, exposes a cancellable non-masked page state,
  and rejects an already enrolled MAC instead of silently reassigning it. Focused
  automated coverage passes; post-change `390x844` runtime verification remains
  pending a platform-admin screenshot. Discovery
  attaches `onBluetoothDeviceFound` before `startBluetoothDevicesDiscovery`
  (`powerLevel: 'high'`), polls `getBluetoothDevices`, logs every nearby BLE
  device plus target hits, and distinguishes timeout copy for no BLE ads /
  name miss / unauthorized enterprise. If `createBLEConnection` returns
  `already connect` / errno `1509007` after a cold re-entry, the session is
  resumed (services/characteristics + ready callback) instead of clearing the
  remembered device. Staff workbenches (measurer/designer/enterprise_admin) and
  `App` silently auto-reconnect when a remembered device exists
  (`trySilentBleReconnect` / `trySilentBluetoothReconnect`) so the home status
  shows connected without a tap. Opening the adapter now declares
  `scope.bluetooth`, treats `already opened` as ready, and classifies Huawei
  HarmonyOS `system permission denied` / 10001-while-Bluetooth-on as a nearby-
  devices permission gap instead of toasting「请打开手机蓝牙」. iOS 13.x never
  waits on `wx.authorize(scope.bluetooth)` (it does not grant system Bluetooth
  and can hang with no callback); `openBluetoothAdapter` is what pulls the
  system permission prompt, including when iOS reports `bluetoothEnabled` as
  false. Adapter-open failure, scan timeout, discovery failure, and Android
  permission denial
  invoke the connect callback with `false` so `ble-connector` clears its
  loading lock; closing the sheet during search calls `cancelBLEDiscovery`
  and stays dismissible.

### Shared designer contact presentation

Designers and measurers can maintain their unlocked professional title, career start year, and title preference from `profile-edit` through `GET/PATCH /api/miniprogram/staff/professional-profile`; enterprise-forced visibility disables the employee switch with an explanation, and a locked profile disables all professional edits. The page previews the final customer-visible title/experience/service labels and shows the raw count only to the staff member. Customer project and claim DTOs expose only the resolved `professionalProfile` using stored title text (no 设计师/测量员 rewrite). The archive GET resolves designer and measurer slots independently so one person in both cards uses each role's enterprise default. The designer contact sheet inserts that proof between identity and the unchanged QR stage: a visible title shares the credential heading with the designer name, while the experience and service labels use licensed semantic icons. Hiding the title removes that heading and restores the name to the relationship pill so identity is never lost. The V4 service archive personnel cards consume the same resolved `professionalProfile` (`title` when visible, plus `experienceLabel` / `serviceLabel`); the designer card role is `家装设计顾问` without a 专属 prefix. No measurer QR capability is introduced.

- `components/designer-contact-sheet` now follows the user-approved `design-references/designer-contact-sheet/designer-contact-sheet-xiao-k-bubble-v8-candidate.png` across `pages/index/index`, `packages/business/free-design-service/free-design-service`, and `packages/business/customer-project/customer-project`.
- The production overlay keeps the existing designer-contact data and actions, but restores a QR-first hierarchy with Xiao K gripping the green architectural header, a warm-white native-text speech bubble to Xiao K's right (`比小红书更方便贴心的 / 家装顾问`), a warm-white unobstructed QR stage, the prominent `长按二维码 识别后添加` instruction, WeChat ID copy, retry, preview, mask-close, and outside close controls. The speech-tail geometry points back to Xiao K and remains outside the contact-action flow. The component reads `getMenuButtonBoundingClientRect().bottom` on attach and every open, then places the card so the bubble clears that native capsule boundary by `16rpx`; the fallback uses current window/status-bar metrics. On a page with a visible custom TabBar it also docks the overlay above `--sfp-custom-tabbar-safe-height` so the outside close control stays fully tappable; callers without a TabBar keep the original bottom inset. The user-supplied Service-tab screenshot of the clipped close control is the QA evidence for this correction.
- The standalone production artwork mapping is the retained Xiao K treatment -> `miniprogram/images/designer-contact/xiao-k-peeking.png`; the retained medal, compass, and customer-heart semantics map from `docs/icon-sources/designer-contact/` to three optimized PNGs under `miniprogram/images/designer-contact/`. The speech bubble, dialog structure, data-driven copy, background, and controls remain native WXML/Less.
- `packages/business/free-design-service/free-design-service` now follows the single composed source `docs/superpowers/specs/2026-08-25-free-design-service-contact-conversion-design.md`: a newly assigned success result with any usable designer contact still opens the shared sheet once. After dismissal, the archive-first Hero owns the only filled `查看服务档案` action and three native archive rows; the designer card is secondary with compact `查看微信`, honest matched/synchronizing state, and only the real public `professionalProfile` title/experience/service proof. Existing attribution restores the approved option-C continuity drawer: the only filled `继续查看服务档案` resumes the preserved archive, while designer WeChat remains in the compact supporting rail. The old WeChat-purpose helper and duplicate full-width contact action are removed because customers can initiate booking and review plans in-platform. The page still renders no duplicate inline QR; QR-only and WeChat-ID-only contacts share the same dialog. Routes, APIs, claim idempotency, permissions, and role boundaries are unchanged.

## Role onboarding guides

The optional role guides live in the `packages/guides` subpackage so their
illustrations do not inflate the main package. `enterprise_admin`, `designer`,
and `measurer` each receive one automatic first-entry presentation from the
overview workbench, then can replay their approved three-step guide from Mine.
Each guide's three slides are a native non-looping `swiper`: swipe left/right
to review a previous page, tap the dots or step rail to jump, and use「下一步」
to advance; autoplay is off. The enterprise final CTA opens the existing
activity-code presenter; the designer final CTA opens `staff-earnings`; the
measurer final CTA returns to today's workbench tasks. `customer` remains
non-forced: `packages/guides/customer-guide/customer-guide` opens from the
Service-home Xiao K speech bubble on wide screens and from its in-flow
`点击我带你看看` entry below the Hero helper copy at `<=400px`, never on first
entry, from Mine, or through
local seen-state storage. Its four native non-looping slides explain the three
free services, expressing needs, the real demand/booking/design path, and the
existing service archive; skip and the final CTA return to the Service tab. It
adds no capability, API, or permission boundary. Capability mapping is
`enterprise.operations`, `staff.leads`, and `staff.schedule`; each guide's
generated palette-optimized transparent PNG cutouts stay below the 300KB
packaged-asset limit. All five custom guide navigation bars reserve the native
capsule lane through `navigationRight` on a `border-box` header whose min-height
includes the status padding, so「跳过」stays in the capsule-left lane instead of
overflowing under the WeChat menu. Their titles are explicit single-line
labels and the skip action cannot shrink, so the unused capsule-left space is
available to the title rather than producing a spurious wrap. The regenerated `measurer` scenarios map to
`assets/measurer-v1/{measurement-bench,measurement-path,measurement-complete}.png`
at 900×960 / 960×640 / 867×960 and 100,280 / 64,543 / 82,506 bytes; the full
`packages/guides` subpackage is 1,276,739 bytes, below its 2MB source limit. The
designer guide defers the existing WeChat-profile completion prompt until the
first-run guide has been seen. Authenticated `390x844` native-capsule visual
QA is pending the user's runtime screenshot.

The Mine account row now qualifies `referrer`, `enterprise_admin`, `designer`,
and `measurer` for the whole account, not only the currently signed role;
switching to customer no longer hides replay. The current role still opens its
own guide path through `roleGuide.js`.

## Visual QA Record

### Logged-out Mine gateway

The visitor state of `pages/mine/mine` continues to use
`design-references/auth/miniprogram-guest-login-jovekore-v2-full.png` and
`docs/miniprogram-role-shell-design-v1.md` as its single current design source.
Production no longer stacks `<=360px` reductions on the doorway scene, panel
margins, heading, or identity-icon containers, preserving the intrinsic
scene-to-panel reading group. `立即登录` explicitly fills the panel content
width, the three identity PNGs are sized by visible alpha bounds, and the trust
row uses the license-recorded `images/mine-icons/shield-check.png` instead of a
CSS pill approximation. Route, `goToLogin`, identity, API, permission, and
custom-TabBar suppression boundaries are unchanged. Focused layout, asset
signature, and narrow-screen guard tests pass; revised `390x844` and user-tall
native-capsule captures remain pending the user's manual review.

### Customer service archive

`packages/business/customer-project/customer-project` now uses the approved
`design-references/customer-project-archive-redesign-v4/customer-project-archive-balanced-color-v4.png`
as its single current source. The native route keeps the existing owner-only aggregate,
appointment permissions, protected v4 floor-plan preview, site-photo capture, read-only
published-scheme folio, designer contact dialog, staff phone calls, and poster-share path.
Only the information architecture and customer copy changed: the compact Xiao K progress
Hero leads to a warm appointment panel, mint/blue service-team cards, and one three-row
archive book. The appointment status badge sits on the `预约量房` title row so the helper
`选择方便的时间，家装现场顾问会提前与你确认` occupies its own wrapping line instead of being
ellipsized. The green Hero title/subtitle are now fixed as `您的家装顾问` /
`现场顾问与设计方案全记录` rather than the aggregate `heroTitle` (lead or community name).
All customer booking controls now say `预约量房` / `重新预约`; the designer card
role is `家装设计顾问` (no 专属 prefix), and assigned staff cards render the
resolved customer `professionalProfile` (`title` when visible, plus
`experienceLabel` / `serviceLabel`) instead of hardcoded 金牌/资深 copy. The first user-supplied tall-device runtime
capture confirmed the structure but exposed legacy substitute icons, oversized person-card
whitespace, and tall dossier rows. The route now packages one license-documented rounded-line
family from `docs/icon-sources/customer-project-v4/` to
`miniprogram/packages/business/assets/customer-project-v4/`, mapping calendar, person, ruler,
document, image, delivery-file, phone, and WeChat semantics. Service-card spacing, dossier rows,
and post-spine content alignment are recalibrated to the approved source. The bilingual ledger
records the production sizes and spacing; focused customer-project tests pass. Routes, APIs,
models, tenant scope, permissions, and role boundaries are unchanged. Per the project's manual-QA
rule, authenticated `390x844` native-capsule and revised tall-device optical checks remain pending
the user's runtime screenshots.

The anonymous free-design claim route
(`packages/business/free-design-service/free-design-service`) now uses the approved
`design-references/free-design-service-phone-auth-three-benefits-v1/free-design-service-phone-auth-three-benefits-v1.png`
for phone authorization while preserving the implemented claim contract and all
post-authorization states. The official production lockup remains
`/images/home-ip-v1/brand-logo.png` + **家客来**. Phone authorization removes the
acquisition stepper and every home-visit, surveying, appointment, address, and
designer-matching prompt. Its single first-viewport reading group uses
**装修问题找微信家装顾问，免费问清楚**, then only **免费效果图 / 出到客户满意为止**,
**免费家装设计顾问 / 解答你的装修问题**, and **免费家装现场顾问 / 解答现场问题**, followed
by the privacy boundary, **允许微信授权手机号**, and **暂不授权**. The full-body
benefit guide is the built-in-imagegen-produced transparent
`packages/business/assets/referral-service-v1/xiao-k-three-benefits.png`
(`560x473` indexed-colour transparent PNG, `26715` bytes, F1 stepped body and complete black limbs retained).
All copy, benefit rows, privacy treatment, and controls remain native WXML/Less;
the approved page mockup is not sliced. The user's first `1080x2400` tall-device
screenshot exposed a restoration defect: nested flex growth stretched the artwork
stage and opened a roughly `500px` physical hole before the first benefit row,
while the mascot, rows, and icons rendered undersized. The corrected phone-auth
reading group now uses content-intrinsic sizing (no nested flex-grow), a fixed
artwork stage, source-proportional benefit rows/icons, and semantically matching
image, lightbulb, and location glyphs; extra tall-screen space
cannot enter between the mascot and benefit list. Heights at or below `760px`
restore vertical scrolling. The user's second `1080x2400` screenshot confirmed
the reading-flow repair but exposed an optical-scale mismatch: labels, helpers,
icon circles/glyphs, the privacy note, and CTA were one hierarchy step smaller
than the approved source despite clearing the project typography floors. The
state is now calibrated to the route-specific `48/36/28/32rpx` title/label/helper/CTA
scale with `124rpx` icon circles and `78–88rpx` glyphs; the floors are no longer
treated as restoration targets. The user's subsequent manual tall-device review
judged the calibrated restoration essentially matched and accepted the typography
and icon scale. Pending and existing-attribution behavior, routes, APIs, identity,
claim results, permissions, and navigation boundaries are unchanged. Focused
referral-service and transparent-asset tests guard the intrinsic-flow contract.

The success state is now archive-first under the same composed route contract. It
uses balanced `领取完成 / 授权完成 / 顾问已匹配` labels, the archive headline and
native `服务进度 / 户型档案 / 设计方案` index, one filled archive CTA, and the
independently generated `520x567` indexed transparent `xiao-k-service-archive-guide.png`
(`20672` bytes). The secondary designer card reads the claim DTO's existing public
`professionalProfile`; missing proof fields collapse instead of inventing a title,
years, or service count. The packaged Xiao K asset, not the whole-page mockup, maps
the approved composite to production. The user's `1080×2400` runtime capture confirms
the archive hierarchy and real proof content while exposing native-button auto-width
expansion that compressed `家装设计顾问` to an ellipsis. Production now pins
`查看微信` to a `148rpx` supporting width (`132rpx` narrow), preserves the full role,
and gives the service-count proof its own aligned row. Focused archive-first,
fixed-button-width, and PNG package checks pass; revised tall-device and `390x844`
native-capsule captures await manual review.

The employee/referrer onboarding route
(`packages/business/onboarding/onboarding`) now uses the user-supplied
`design-references/onboarding/referrer-enterprise-invitation-20260828-v7.png` as the
sole referrer-ready design source. It restores the mint architectural invitation
Hero, native **欢迎加入 / 推广团队** copy, three truthful promotion benefits, dynamic
enterprise invitation card, three-step flow, trust row, and authorization CTA while
preserving the existing resolve, phone authorization, name confirmation, role, and
navigation contracts. The referrer-ready helper **加入后即可获取专属推广码** is
display-only and does not navigate. Independently generated transparent art maps to
`images/onboarding-referrer-v7/{xiao-k-promoter-hero-v7,enterprise-building-v7}.png`,
both under 300KB, plus the independently generated runtime-correction icons in
`packages/business/assets/onboarding-referrer-v7/{promotion-code,promotion-progress,promotion-commission,promotion-person-plus,promotion-cta-shield}-v7.png`
(all under 5KB). The supplied composite was never sliced. The correction also keeps
the first invitation sentence on one line and aligns each step number with its title.
Staff-ready and recovery
states retain their prior design 16/17 source and behavior. Full-host `390x844`
evidence remains pending manual verification.

The new acquisition, referrer, customer-service, booking, availability, service-code,
lead-detail, and commission workflow styles were reviewed against their current ledger
sources. Supporting text and status chips are now at least `22rpx`; primary business
values, body copy, and actions are at least `24rpx`. Only the non-text decorative
`lead-form` area icon is exempt. The focused static guard is
`miniprogram/test/miniprogram-typography-floor.test.js`; refreshed authenticated
`390x844` host captures remain pending because no verified Mini Program automator
endpoint is available.

Appointment-detail embeds the availability picker on-page when `canReschedule` (shared helpers in `utils/appointmentSlotPicker.js`): 5-day window with prev/next paging, slot selection, optional staff reason, and a full-bleed sticky cancel|confirm bar with frosted page-tone background (≈0.9∶1.3 flex + 20rpx gap, shared 26rpx centered labels; confirm full-width when the role cannot cancel; dynamic「确认改期至…」label; disabled until a slot is selected (mint `--action-disabled-bg`, not WeChat `#f7f7f7`); page `padding-bottom` 200rpx clears the bar). Staff `开始量房`/`确认完成量房`, `修改服务地址` ∥ `一键导航至量房地点` (equal-width pill secondary row + 16rpx gap with packaged ruler/edit/map-pin PNGs), **拍现场图** (tag-first into the lead gallery; the room-tag sheet is `root-portal` at z-index 2000 and hides the sticky native cancel|confirm bar while open so chips are not clipped), and community sync stay in a scroll secondary region so reschedule owns the sticky primary while the visit is still bookable. When `serviceStage` is `survey_ready`, `canReschedule` is false and the sticky primary becomes `确认完成量房` so confirm is not buried under the reschedule bar. Customer copy「量房已完成」is only `survey_completed`; pending confirm still reads as an in-progress visit and does not open rebooking. `appointment-reschedule` is a compat `redirectTo` shell to detail (mode mapping: absent/`customer` → customer detail; `internal` → staff detail). `POST /api/appointments/[id]/address` and `POST /api/appointments/[id]/internal-reschedule` authorize Mini Program staff by `staff._id` before Admin JWT. Measurers and enterprise owners see `开始量房`/`继续量房` until the linked lead is `survey_ready` (completed formal v4 plan with at least one closed space, or the lead DTO `serviceStage`); only then does `确认完成量房` appear on appointment detail and as the measurer workbench primary chip. Completing an appointment remains server-gated with the same rule, otherwise `POST /api/appointments/[id]/complete` returns `appointment_survey_required` (409). `GET /api/appointments` and lead/workbench appointment DTOs emit ISO-8601 `timeRange`; the customer service archive, the customer service archive, measurer-calendar, appointment-detail, and related staff surfaces parse postgres or ISO ranges through `utils/appointmentTimeRange.js` and bucket visits on Asia/Shanghai dates with a fixed UTC+8 conversion (no `Intl`, which some WeChat JS engines omit) with a fixed UTC+8 conversion (no `Intl`, which some WeChat JS engines omit), so a confirmed next-day visit appears on that calendar day instead of as「时间待确认」。 The measurer-unavailability list card uses a compact inline delete control, and the measurer-calendar unavailability card keeps its timer icon inline with the title. Spec: `docs/superpowers/specs/2026-08-21-appointment-detail-inline-reschedule-design.md`; refreshed authenticated `390x844` capture is still pending.

On 2026-08-20, the referrer workbench enterprise selector removed index-based fixed widths: each enterprise pill now takes its natural single-line width in the existing horizontal scroller, so a long enterprise name cannot overlap the next membership or the add-enterprise control. Primary labels and business values on the workbench are `24–28rpx`; explanatory copy is `20–22rpx`. Add enterprise now opens the native QR scanner, accepts only the existing onboarding route with a `token` or `scene`, and hands the scanned value to the existing server-validated onboarding flow; scan failures, invalid codes, and navigation failures receive explicit feedback, while cancellation leaves the user on the workbench. The API, membership switching boundary, and role permissions are unchanged. Authenticated `390x844` host capture remains pending because the current DevTools window has no verified automator endpoint.

### Customer service needs recording (implemented)

- Customer route: `packages/business/service-needs/service-needs`; the success state of `packages/business/free-design-service/free-design-service` exposes the subdued `有其他服务需求？补充一下 ›` link below the primary archive CTA and removes the old `稍后再看` action.
- Customer API: `GET/PUT /api/miniprogram/customer-projects/[leadId]/service-needs` verifies the signed customer owns the unarchived lead and stores an allowlisted set of `old_house_consultation`, `materials_consultation`, and `partial_space_advice` records in tenant-scoped `app.lead_service_needs` (`admin/drizzle/0041_lead_service_needs.sql`) without changing `serviceStage`.
- Staff API/UI: assigned designers, measurers, and enterprise admins can use `GET/PATCH /api/leads/[id]/service-needs` from `lead-form?mode=edit` to record the result of WeChat communication. The empty selection clears records. The platform does not provide in-app chat or claim automatic WeChat friend addition.

### Existing-attribution visual update (implemented)

The `free-design-service` existing state now restores the user-approved option C at `design-references/free-design-service-existing-redesign-v2/option-c-continuity-archive-drawer.png`. Its native continuity ticket presents the preservation badge, masked free-design-service reference, truthful current stage/update, three-stop path, and tappable `服务进度 / 户型档案 / 设计方案` folder tabs; every tab and the sole filled `继续查看服务档案` resume the original archive without claiming completion. The former full-width designer-contact action is a fixed `148rpx` (`132rpx` narrow) supporting `查看微信` inside a compact designer rail, with available real `professionalProfile` title/experience/service proof. Stage derivation remains grounded in existing lead status/service-stage copy, with `现场顾问`/`上门` correctly mapped to surveying arrangement. The approved drawer Xiao K maps to the built-in-ImageGen-produced, alpha-optimized `720×346`, `25733`-byte indexed-colour transparent `xiao-k-continuity-archive-drawer.png`; copy, state, tabs, and controls remain native. `GET /api/miniprogram/customer-projects/[leadId]`, contact authorization, archive routing, and claim idempotency are unchanged. Focused contract, image, typography, and package checks pass; revised tall-device and `390x844` native-capsule captures await manual review.

### Personal referrer invitation disclosure

For an active personal referrer join code, `GET /api/miniprogram/codes/resolve`
returns `inviterDisplayName` only when its inviter is an active, eligible employee
with a non-empty display name. `packages/business/onboarding/onboarding` renders
“由企业员工 {name} 发起邀请” in the existing invitation card, and
`enterprise-join-codes` shares “{name}邀请你加入{enterprise}推广团队”. Enterprise-wide
codes show neither a personal name nor a generated username. The display is
limited to the employee name: it exposes no phone number, WeChat ID, avatar, or
new permission, and it does not change the enterprise-owned membership, first
inviter snapshot, tenant scope, or commission rules.

## Maintenance

### Operations trend labels

The enterprise-owner `pages/enterprise-operations/enterprise-operations` canvas keeps the existing two real `contractAmountTrend` series and their role/API boundary. To preserve readability at `390x844`, it now renders compact value pills for selected nonzero points (in 万元), including a peak at the chart's top edge; zero-value points remain unlabelled and both-zero series still use the existing empty state.

### Role entry tightening

Legacy login responses with `role: user` are normalized to the `customer` context so cold launch cannot render the old floor-plan shell; remaining packaged promotion, commission, inspiration, and recommendation deep routes are explicitly capability-mapped instead of being implicitly allowed.

Customer, referrer, designer, measurer, enterprise-owner, and platform-admin Mine retain account, identity, and security controls but no longer render the legacy floor-plan list, create-survey, or start-survey actions. Signed `platform_admin` uses the same role-shell staff Mine as designer/measurer/enterprise owner (no stats, workbench, todos, AI-design banner, or customer floor-plan archive). The referrer TabBar now exposes the contractual `Promotion/Customers/Earnings/Mine` destinations directly. Designer and measurer TabBars expose the same `Earnings` destination (`staff-earnings`) for own lead-commission rows as **payable/paid counts and status only** (no `amount`). The enterprise-owner TabBar exposes `Commissions` (`enterprise-commissions`) as a tenant payout ledger with payable/paid/voided **amount** totals. Its customer-contained payout batches distinguish the payable status from the tappable **确认线下付款** action; the native confirm is **确认付款**, and successful rows read **已完成线下付款**. All payable referrer/designer/measurer rows also expose a secondary **调整金额** action backed by `LeadCommissionRepository.adjustPayable`; Mini Program owners still cannot change beneficiaries, and payment remains a separate confirmation. Customer lead details hide formal-survey edit/create/delete actions. An assigned designer has start/continue/add/delete controls on their assigned lead detail. An assigned measurer enters the sole formal editor from their Workbench task, while an enterprise owner has the same start/continue/add/delete controls on every lead in the signed enterprise. Enterprise owners also receive the existing lead-bound AI-design entry on every open, unarchived lead; this reuses the current scheme studio and does not add a separate owner Design tab. Lead creation is exposed only to the enterprise owner and writes `manual_entry` with automatic designer/measurer pool assignment. Booking, appointment-detail, and reschedule deep links are capability-mapped for customer, designer, measurer, and enterprise-owner contexts, and the shared `openSurveyingEditor` helper performs a second signed-context check.

### Enterprise commission amount adjustment and zero-amount quick ledger

`PATCH /api/miniprogram/enterprise-commissions/[id]` is restricted to the signed `enterprise_admin` and changes only `payableAmount` on a current-tenant `payable` row. The same action and repository audit apply to referrer, designer, and measurer rows; the Mini Program cannot change a beneficiary, and paid or voided rows remain immutable. The payout ledger exposes a secondary `调整金额` action beside payment confirmation for all three roles, validates a non-negative amount with at most two decimal places, keeps the dialog open on API failure, and reloads tenant totals after success.

`POST /api/miniprogram/enterprise-commissions/record-zero-payment` remains the combined adjustment-and-payment shortcut for exactly one `payable` row whose current `payableAmount` is `0.00`. It validates a positive amount with at most two decimal places, records the existing adjustment audit as `小程序线下付款补录`, then marks the same row `paid` in one Mini Program PostgreSQL transaction. `POST /api/miniprogram/enterprise-commissions/mark-paid` rejects zero-amount rows for Mini Program callers, so a batch containing one has no batch-confirm action; nonzero rows retain the standard confirmation. The payment tap is consumed by the payout action itself; zero-amount rows open a viewport-pinned quick-ledger dialog whose border-box shell and flex action row keep both native buttons inside the card on narrow screens, while missing/stale record IDs and duplicate in-flight taps return visible feedback instead of silently doing nothing.

When a route, API, permission, data contract, status, limitation, or visual
source changes, update its row and the Chinese mirror. Keep one current row per
route in the restoration ledger. Do not append date-based implementation notes,
superseded references, or duplicate test transcripts.

Chinese mirror: [miniprogram-system-modules.zh-CN.md](./miniprogram-system-modules.zh-CN.md)
### Referrer withdrawal (Implemented)

`GET /api/miniprogram/referrer-progress` returns an opaque `recordCode`, creation time, terminal subtype, withdrawal eligibility, block reason, and the ten-minute undo deadline. The Mini Program 客户 Tab labels the action as solid 撤回 and the ten-minute undo as 恢复. Referrers can call `POST /api/miniprogram/referrer-progress/withdraw` or `/withdraw/undo` with the active membership context and an `Idempotency-Key`. A withdrawn referral remains a read-only `closed` lead with `terminationType=referrer_withdrawn`; staff receive an in-app acknowledgement notice and the customer sees a service-terminated archive with all service CTAs disabled.
