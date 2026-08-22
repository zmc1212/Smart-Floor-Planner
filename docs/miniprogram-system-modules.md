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
  create an ordinary customer account; the phase-3 referral claim endpoint can
  also consume WeChat authorization codes and atomically link the account,
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
  Platform channel `salesperson` accounts may have a null `enterpriseId` and
  still bootstrap with capabilities `promotion.records` /
  `promotion.commissions` / `account`. Platform admins land on the device enroll workbench (`platform-device-workbench`):
  BLE scan collects nearby `LDMStudio 4D` MACs without connecting, then checkbox /
  assign-all posts to `POST /api/miniprogram/devices`. Enterprise staff
  still must pass `POST /api/devices/verify-binding` (enterprise ownership only)
  before a single measurement connection. Refresh work is token-versioned, so a
  stale cold-start failure cannot clear a newer phone-login session; an invalid active context clears
  local session state, and a referrer
  context restores the promotion workbench instead of silently falling into the
  ordinary-customer shell.
- Primary actions use locally stored, license-documented icons. Native host
  capsule and safe areas remain outside the content lane.
- The source package explicitly excludes development folders and unreferenced
  historical design artwork through `project.config.json` `packOptions.ignore`;
  the primary package keeps only its current runtime assets and leaves margin
  below the WeChat 2MB source-package limit. Main-package artwork under
  `images/` is palette-optimized in place; unused hero/legacy rasters and
  local design tokens stay ignored. The `packages/business` subpackage
  stays under the separate 2MB subpackage source-size cap by packaging only
  runtime artwork (palette-optimized PNGs), excluding unused referral/customer
  historical assets, and loading Xiao K mascots from the main-package
  `images/airy-v1` copies instead of duplicating them under business.
- `Implemented`, `Limited`, and `Placeholder` describe executable runtime
  behavior, not labels or mock responses.

## Page inventory

Appointments retain a manual service address plus an optional WeChat-map `gcj02` location (`locationName`, latitude, longitude). Booking keeps manual building/unit/room entry and adds native `wx.chooseLocation`; the assigned designer, measurer, or enterprise owner can update the same location through the existing versioned `POST /api/appointments/[id]/address` authorization and audit. That endpoint resolves Mini Program staff identity before Admin JWT so a measurer is authorized by `staff._id === appointment.measurerId`, not the WeChat user id. Creating or updating an appointment copies an empty lead `communityName` in the same transaction from the map `locationName` when present, otherwise the typed service address (trimmed to 160 characters; never overwrites). Appointment detail still offers staff an explicit sync for historical empty communities via `PUT /api/leads/[id]`. A confirmed appointment with coordinates opens native `wx.openLocation` for its authorized viewer; the measurer calendar uses it for its navigation shortcut. Historical/manual-only appointments remain valid but explain that a map point is not recorded. Referrers never receive exact addresses or coordinates.

| Surface | Runtime routes | Current contract | Status/limitation |
| --- | --- | --- | --- |
| Home and measurement entry | `pages/index/index` | Customer Service home is the stage-companion shell (`docs/superpowers/specs/2026-08-21-customer-service-home-stage-companion-design.md`): derived `serviceStage`/`nextActionKind`, customer-readable `appointmentSummary` (pending match uses「正在为您匹配设计师和测量员」, never staff staffing nextAction; inset helper「匹配完成后可预约上门」so「等待派单」only appears on the primary CTA; dual CTAs share `28rpx` labels), Xiao K early-stage inset (design 01 dual thumbs only when real media exist), and one next action (`book` / `reschedule` / `rebook` / `view project` / `wait for assignment`) that opens booking flows or goes straight to the service archive—no intermediate project list. `GET /api/miniprogram/customer-projects` feeds home ranking and the multi-project switcher (`N = length − 1`); `customer-projects` itself is only a deep-link redirect shell. Signed designers and measurers enter their role workbench; measurers open `measurer-calendar` from the workbench for itinerary management. The measurer overview hero CTA is **链接测距仪** (shows BLE connected/disconnected from `app.globalData.bleConnected`) and opens the existing `ble-connector` sheet; formal survey still enters only from assigned task cards (`立即量房` / `继续量房` / `新增量房`), not from the hero. The measurer workbench is lead-oriented: for one lead, a replacement `confirmed` appointment replaces any earlier `expired` appointment in task cards and counts; without a confirmed replacement, only the latest expired appointment remains as the pending task. The calendar retains appointment history. Unscheduled measurer task cards without a floor plan keep `立即量房` plus `预约上门`; when an activity-code lead has already locked the measurer but designer assignment is still pending, the card badge stays `待量房` and meta shows `未预约上门` instead of pairing enterprise `待派单` beside it; a draft linked plan switches the same card to `继续量房` (loads `floorPlanId`) and `新增量房`, and hides booking. A completed formal v4 survey is filtered out of the pending workbench queue and `待量房任务` count even when the appointment row remains `expired`, and converted/closed leads leave both confirmed and expired workbench cards (`shouldIncludeMeasurerWorkbenchAppointment`); the calendar still keeps full appointment history. Confirmed appointment cards that already have a linked plan also expose `继续量房` / `新增量房` so the saved graph can be reopened until the visit is completed. Enterprise-owner Operations restores R01 from `18b-enterprise-ops-dashboard-period.jpg` (custom filter sheet `18c`): capsule-safe identity-nav scan/bell via runtime menu-button metrics, hero pills (`待派单`/`待量房`/`已交付`), quick nav (`待处理线索`/`人员负荷`), period-filtered ops dashboard (chips `本周`/`本月` default/`本年` + custom bottom-sheet; five read-only KPI cards: 新增线索, 已完成量房, 方案交付率, 已签约, 签单率 = same-window converted÷new leads; owner subtitle `全店 · …` may include签约金额 detail), 出示入驻码 CTA (Admin dual join codes via packages/business/enterprise-join-codes/enterprise-join-codes with generate/rotate/disable; WeChat modal confirmText kept to <=4 chars so generate is not a silent no-op; not staff-activity), and exception cards for pending assignment, expired unrebooked work, and staffing gaps (pending assignment opens lead detail, expired unrebooked opens appointment detail, staffing-gap 查看详情 and 人员负荷 open `packages/business/enterprise-staff/enterprise-staff` — owner-only designer/measurer roster with pause/resume via `GET/PATCH /api/miniprogram/enterprise-staff`; WeChat ID/QR remain self-serve on `profile-edit`, and empty roster CTAs open join codes), all from `GET /api/miniprogram/workbench?period=`. Designer/measurer workbenches insert the same five-card personal dashboard (`04b`/`05b`, subtitle `我的 · …`, no contract amount). The designer overview no longer renders the static「常用配方」strip below the delivery list; quick-nav「风格配方」still opens the Design tab. Hero `已交付` remains scheme-publication count and is not the signed KPI. The local `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` switch opens a fresh editor without loading recent plans | Implemented/Limited; unsigned visits to this root route immediately `switchTab` to the JoveKore｜家客来 visitor gateway on `pages/mine/mine`, so the legacy marketing home shell is never a second logged-out page. Role workbenches consume server-derived `GET /api/miniprogram/workbench` and the customer list/detail `serviceStage`/`nextActionKind`, and must not invent a second stage vocabulary. Dashboard signing facts are read-only KPIs (`status=converted` via `convertedAt`); the home surface still does not offer签约/改状态 actions. On cold launch, the custom TabBar and role pages derive the first render from the stored signed `mode/staffRole` context. The customer TabBar exposes only Service and Mine. Tab badges come from bootstrap `counts` (customer first-booking/reschedule/rebook, designer follow-up plus expired, measurer combined workbench badge (today plus pending survey tasks), designer/measurer payable earnings, owner exceptions including expired unrebooked); failed counts show `暂时无法读取` and never a local zero. Authenticated `390x844` native-capsule QA for the new role states remains pending. The legacy marketing home shell no longer calls `wx.getLocation` or `POST /api/location/reverse`; signed roles render `role-workbench`, and any leftover city label is profile/community-derived only.|
| Leads and customer records | `pages/leads-management/leads-management`, `packages/business/lead-form/lead-form`, `packages/business/lead-detail/lead-detail`, `packages/business/customer-ai-schemes/customer-ai-schemes` | Lead list/detail, conversion state, formal-plan summary; list thumbnails prefer formal `previewUrl` through `fetchProtectedImage` (`GET /api/floorplans/[id]/preview`), then Kujiale `externalSource.previewUrl`, then CSS wall segments. Unarchived lead detail exposes **补充资料** and a two-card strip for the assigned designer and measurer name and phone from the existing `GET /api/leads/[id]` `assignedTo`/`measurerId` staff summaries (unassigned renders 待分配; enterprise admins tap 待分配 to open the enterprise-staff picker and submit `POST /api/leads/[id]/assign-staff`, which fills only missing roles and rejects overwrite; assigned phones can still be tapped to call), and enterprise admins plus the assigned designer or assigned measurer open `lead-form?mode=edit` (default WeChat navigation with the native back control) to update name, phone, community, area, and style through `PUT /api/leads/[id]`; communityName on that form accepts native `wx.chooseLocation` (POI name, sliced to 160) plus manual typing, matching appointment booking’s map-plus-input path, and does not persist map coordinates on the lead; enterprise admins still create customers from the list (`source=manual_entry`); those leads use the same designer/measurer pool assignment as referral-network claims, do not bind `customer_user_id`, and snapshot designer plus measurer commissions on signing. The assigned designer can enter first booking when no confirmed appointment exists, and a staff-activity measurer can book the first visit for that same lead; the owning customer can enter the same server-backed booking flow from Service home after measurer assignment and from the project folio. Automatic measurer assignment is displayed separately from the pending appointment time. Designer, measurer, and enterprise-owner Customers tabs share the same `leads-management` + `lead-list` shell; list scope stays role-scoped (`promoted-or-assigned` for designers, `measurer`/`measurerId` for measurers—aligned with the workbench task queue—and tenant-wide for enterprise owners), create-customer remains enterprise-owner only, and formal surveying stays reachable only from assigned measurer task context on the Workbench. Today's pending survey queue (confirmed appointments and unfinished formal surveys) remains on the measurer Workbench overview, not the Customers tab. `GET /api/leads/[id]` now counts active AI publications when deriving `serviceStage`/`nextAction` and returns `publishedSchemes` ordered by `firstPublishedAt` with images that include `stageKey`/`publishedAt`; lead detail merges the appointment CTA into the right side of the formal-survey card (no standalone appointment container) and hides that CTA after survey completion or publication while keeping house facts (community, area, stored appointment address, closed room names) plus a read-only protected floor-plan PNG preview for enterprise admins and the assigned designer/measurer (`wx.previewImage`, never `surveying-editor`), and published-scheme summaries open the read-only `customer-ai-schemes` folio (`mode=staff`); after formal survey, designers also see **进入 AI 设计** on lead detail even with zero publications (`openAIDesignEntry` → scheme-studio with `leadId`/`floorPlanId`), while the Design tab remains the general creation entry. The designer workbench uses the same publication count for `方案已发布` badges, prioritizes unpublished survey work ahead of published follow-ups, and omits converted/closed leads from follow-up cards because a signed lead ends platform progression. JWT-backed staff sessions load the list without requiring a legacy OpenID. The 客户 tab loads that list on first attach, when returning to the tab, and on filter or pull-to-refresh; it does not background-poll. When a referral-network lead enters `converted` through the existing signing endpoint, the server snapshots referrer, designer, and measurer commissions in the same transaction; staff-activity leads snapshot designer and measurer only | Implemented/Limited; conversion, customer ownership, appointment-entry, manual-assign, and preview permissions are server enforced, and role Tab items are capability-allowlisted. Percentage rules require a contract amount and a paid three-role commission blocks enterprise-admin signing reversion |
| Promotion and staff tasks | `packages/business/promotion-records/promotion-records`, `packages/business/promotion-record-detail/promotion-record-detail` | Enterprise referral and staff notification flows; channel-salesperson bootstrap lands here (`我的报备` / pool / create) with TabBar `报备` + `我的` (embedded custom TabBar; icons reuse `tab-home` / `tab-mine`). Subscription taps for staff lead events open `lead-detail`, customer appointment/design taps open `customer-project` | Implemented/Limited; WeChat delivery can fail externally |
| Referrer network, appointments, and anonymous claim | `packages/business/onboarding/onboarding`, `packages/business/enterprise-register/enterprise-register`, `packages/business/onboarding-debug/onboarding-debug`, `packages/business/referrer-workbench/referrer-workbench`, `packages/business/referrer-progress/referrer-progress`, `packages/business/referrer-earnings/referrer-earnings`, `packages/business/staff-earnings/staff-earnings`, `packages/business/enterprise-commissions/enterprise-commissions`, `packages/business/promotion-service-code/promotion-service-code`, `packages/business/staff-activity-code/staff-activity-code`, `packages/business/enterprise-join-codes/enterprise-join-codes`, `packages/business/enterprise-staff/enterprise-staff`, `packages/business/free-design-service/free-design-service`, `packages/business/customer-projects/customer-projects`, `packages/business/customer-project/customer-project`, `packages/business/customer-ai-schemes/customer-ai-schemes`, `packages/business/appointment-detail/appointment-detail`, `packages/business/appointment-reschedule/appointment-reschedule`, `packages/business/appointment-booking/appointment-booking`, `packages/business/measurer-calendar/measurer-calendar`, `packages/business/enterprise-appointments/enterprise-appointments`, `packages/business/measurer-unavailability/measurer-unavailability`, `packages/business/identity-recovery/identity-recovery` | Type-isolated onboarding, promotion code, anonymous claim, customer project, and appointment deep routes retain their contracts. Platform open-account scans land on `enterprise-register`: `POST /api/miniprogram/codes/resolve` accepts `er_` / bare 32-char scene as `kind: enterprise_registration` (platform label only, never a fake enterprise name); after `getPhoneNumber`, `POST /api/miniprogram/enterprise-registration` (Bearer JWT) requires authorized phone === `contactPerson.phone` and shares `createSelfServiceEnterpriseApplication` with Web `POST /api/auth/register-enterprise` (`pending_approval` / `self_service`). UI reuses onboarding brand-lock / airy tokens without a separate design file or new IP art, plus the claim-page back chevron so a QR stack-root can leave; a recents reopen with a signed identity is not sticky, while a chat-card share stays on the form. Staff/referrer `ej_` onboarding remains separate. The enterprise-owner Appointments tab (`enterprise-appointments`) restores R03 `20-enterprise-appointments.jpg` as a dedicated schedule list: capsule-safe “预约调度中心” header, real week appointment count, 7-day strip filter, and `confirmed`/`expired` cards; expired cards show “需协调改期” plus a view-appointment CTA only when the linked lead is still open, while `serviceStage` `converted`/`closed` cards keep a read-only “已签约”/“已关闭” badge with no CTA or detail navigation because a signed lead ends the platform lifecycle; no new dispatch API and no area/layout/measurer-phone fields the workbench item does not return. `GET /api/miniprogram/customer-projects` returns only unarchived projects owned by the current JWT customer (neutral free-design labels) and feeds Service-home ranking/switcher; the customer project folio omits enterprise branding while retaining the owner-only service facts. The retired `customer-projects` route is a deep-link redirect shell (rank → archive or Service tab), not a product list; the project folio remains the real deep route without the TabBar. Its featured delivery header now renders the API-provided scheme title as `已发布{title}方案`; `详情` and `查看全部方案` open the read-only `customer-ai-schemes` folio (`mode=customer`, no generation/edit; round chips ordered by first publication + delivery timeline over `publishedSchemes`, preview via `wx.previewImage`), and the fixed WeChat contact action text stays centered. Referrer progress and earnings are scoped to the signed active membership for authorization; earnings rows follow the current commission `beneficiaryUserId` and `payableAmount` (so a payable beneficiary change moves the row to the new eligible referrer), and return only masked customer labels, service facts, and the referrer's commission state, never a phone number, exact address, wall graph, internal appointment reason, or design file. Selecting an in-workbench referrer enterprise exchanges the signed membership context before the session is refreshed, so its service code, progress, and earnings share that boundary. A valid onboarding code resolves code type and enterprise before phone authorization; a referrer must set a real display name after phone authorization before `POST /api/miniprogram/onboarding/referrer`; a signed customer who already has an open attribution receives the existing project instead of a new claim. Claim/login surfaces `staff_phone_linked_to_other_user` as “该手机号已绑定其他微信账号…” so users can switch phone or ask an admin. The promotion/staff service-code routes and the anonymous claim route now follow airy-minimalist designs 09–13 for presentation, confirm, phone authorization, assigned-designer success, and assignment-pending. Design 09 scan glyphs on the 请扫码 plaque, share CTA, and enterprise dual-code plaque reuse packaged `images/mine-icons/scan.png` (brand green on the plaque, white on the green CTA). Development-only `onboarding-debug` can select a local code into the same real flow. Appointment actions remain separated among designer, measurer, enterprise owner, and customer; appointment detail hides reschedule/cancel/rebook/survey mutate actions when the linked lead is converted or closed; internal reschedule reasons are optional and retained in appointment event audit when supplied. Invalid identities enter a dedicated recovery page before reauthentication | Implemented/Limited; platform enterprise open-account page is Implemented with focused contract tests. A referrer enters the workbench after onboarding, login, and JWT-backed cold launch. A real signed referrer verified both login completion and cold launch at `390x844`, including a native-capsule host capture. The workbench now opens masked progress and own earnings for its current enterprise; customer-project ownership, appointment role checks, and optimistic versions remain enforced. A temporary identity-context read failure leaves promotion controls usable and hides switching. Customer-facing project surfaces intentionally use neutral free-design/free-survey copy; enterprise names remain available only to internal/referrer surfaces. The claim phone-auth hero never renders a renovation-company name for referral or staff-activity scans; the staff-activity presenter may still show the enterprise name. Phase 12 now exposes the current executable referrer/measurer navigation from bootstrap and clears invalid sessions without exposing the invalid tenant. Authenticated `390x844` native-capsule capture of the enterprise appointments tab and enterprise-register page remains pending; new customer-project, progress, earnings, and customer AI scheme routes still need authenticated `390x844` QA; measurer-task aggregation, authenticated appointment/publication actions, and full role production UI remain pending; WeChat delivery is external |
| Commission records | `packages/business/commission-records/commission-records` | Order commissions for eligible commercial roles; staff signing-earnings WeChat taps land here via reused `workflow_todo` | Implemented; settlement remains backend/business controlled |
| Inspiration library | `packages/business/inspiration/inspiration` | Tenant-scoped inspiration browsing and detail | Implemented/Limited; media provider is external |
| AI design workflow | `pages/ai-design/ai-design`, `packages/ai-workflow/*` | Designer Design tab follows D01 (`37-ai-design-workbench.jpg`): green create-scheme hero, popular recipe discovery (static input-capability descriptions without a false selectable state, featured strip, waterfall), and recent design-project cards that open `scheme-studio`. Space chips strictly filter the loaded recipe set; a category with no matching recipe uses the existing empty state rather than silently showing another category. Each recipe opens with a compatible supported input mode. The Design tab remains the **creation entry** (recipe discovery, not the scheme archive). Using a recipe keeps `recipe-detail` → `recipe-project` (pick customer from `GET /api/miniprogram/ai/studio/leads`, then pick or create a scheme from `GET /api/miniprogram/ai/studio/workflows`, then **应用到哪里**) → `recipe-confirm` (continues that scheme) → `scheme-studio`. Selecting an existing scheme adds another round to that conversation; **新建** creates a named workflow like Admin. Scheme cards on that picker use a signed cover of the latest confirmed image, otherwise the latest succeeded generation, and keep the folio placeholder only when the conversation has no generated image. `recipe-project` then defaults to **完整户型** (`targetScope=whole_floor_plan`) and lists the scheme-bound plan's closed survey rooms as **单房间** (`single_room` plus `roomId`, name and size from `GET /api/miniprogram/ai/studio/workflows/[id]` `sourceFloorPlan.rooms`); helper copy states the recipe applies only to the current selection, without generating other rooms or extra credits. Those `targetScope`/`roomId` values are the same space semantics as Admin AI workbench batches via `resolveMiniAiFloorPlanTarget` and `input.roomData`. `scheme-studio` is the **scheme archive and continuation** whose composer apply-to picker (dock chip +「出图设置」) posts the same `targetScope`/`roomId` as Admin. The Design tab header no longer exposes **设计记录**; `ai-design-history` remains as an overlapping task log (`GET`/`DELETE /api/miniprogram/ai/history`, plus Admin `/api/ai/history` and `ai_generations`). Isolated-task results still offer **查看历史**. Weakening this entry does not change the recipe path. Deep links from `lead-detail` / `index` / `pendingAIDesignContext` carrying `leadId` plus `floorPlanId`/`workflowId` open `packages/ai-workflow/scheme-studio/scheme-studio` via `openAIDesignEntry` (or the Design tab's pending-context handoff). Recipe confirmation kicks off the task then redirects into scheme-studio when a lead workflow exists; isolated tasks without a workflow still use `ai-design-result`. History cards expose **进入方案** for synced workflow tasks. Customer/project picker, result/history (legacy single-image publish remains for isolated tasks), lead-scoped scheme publications, and the scheme-studio deep page (`GET /api/miniprogram/ai/studio/*` workflows/tasks/composer/publish) remain available. The static role Tab no longer occupies `pages/ai-design/ai-design` as a measurer entry; the enterprise-owner Appointments tab no longer occupies this shell and opens `enterprise-appointments` | Implemented/Limited; provider, credit, formal-survey eligibility, lead responsibility, publication visibility, and workbench scope are server controlled. Mini Program recipe and create tasks persist scoped `roomData` through the same helper as Admin batches, but `floor_plan_render` still attaches the whole-plan survey-canvas PNG as the control image (`resolveFloorPlanControlPng` without `roomId`); room-cropped control images remain Limited on this channel. Mini `scheme-studio` continuation posts `targetScope`/`roomId` from the D09 composer apply-to picker (dock chip +「出图设置」row, default `whole_floor_plan`, closed rooms as `single_room`). The composer reference row locks a **控制图** thumbnail of that scope (the same crop the batch uploads first). `scheme-studio` restores D09 (`45-ai-scheme-studio.jpg` / `45b-ai-scheme-studio-templates.jpg`): explicit **切换方案** nav action + chips, project-card merge-send CTA, 24rpx gutter between the project card and empty-round card, theme-green `#00c365` composer credit bar with white copy, merged rounds with published badges, Creation-aligned composer (model/count/aspect/resolution, references, cover-grid templates via signed recipe preview URLs, prompt assist, 4s polling, retry; collapsed generate FAB stays inside the dock), merge-publish modal (first send and update both edit the scheme name and sync the workflow title with the customer-visible album title), **设为定稿** beside the published banner (reuses the confirm-dialog pattern; finalized banners read **客户可见定稿**), rename/delete workflow, delete generation, and single-image withdraw. Opening with `leadId`+`floorPlanId` but no `workflowId` reuses the preferred existing lead scheme (same floor plan, then highest `generationCount`) instead of minting an empty conversation. AI workflow Less surfaces follow the raised typography floors (helpers ≥`22rpx`; `20rpx` only for tertiary badges) and are guarded by `miniprogram-typography-floor`. Mobile Limited: no Admin canvas annotation editor (continue-as-reference only), no dark theme toggle, and nine-stage `proposal_pack`/`lighting` stay on existing admin_handoff paths. Authenticated `390x844` native-capsule visual QA for D01/scheme-studio is deferred to owner local verification |
| Mine and account | `pages/mine/mine`, `packages/business/profile-edit/profile-edit`, `packages/business/settings/settings` (compatibility deep link; content merged into the Mine Tab), `packages/business/identity-switch/identity-switch`, `packages/business/identity-recovery/identity-recovery`, `packages/business/account-security/account-security` | Account security, WeChat system permission settings, and server-backed identity-context selection; `GET /api/miniprogram/bootstrap` returns the current role, valid role groups, enterprise/membership context, landing path, capability allowlist, and a server-owned badge summary of role-scoped todo counts. Switching exchanges a signed context token; login, onboarding, claims, switching, and startup recovery refresh and validate bootstrap before shared identity navigation enters a signed landing. `identity-navigation` rejects unknown identities and forbidden deep links; an invalid signed context enters the recovery page, clears its old session, and requires reauthentication | Implemented/Limited; visitors see a capsule-safe JoveKore｜家客来 login gateway with the packaged `images/home-ip-v1/brand-logo.png` and one executable login CTA. No signed role means no custom TabBar at all; only bootstrap-backed or stored signed roles generate capability-allowlisted navigation: customer `Service/Mine`, referrer `Promotion/Progress/Earnings/Mine`, designer `Workbench/Customers/Design/Earnings/Mine`, measurer `Workbench/Customers/Earnings/Mine`, salesperson `报备/Mine` (promotion-records + mine; not the designer/measurer role-workbench shell), enterprise owner `Operations/Customers/Appointments/Commissions/Mine`, and platform admin `Devices/Mine`. Salesperson Mine loads `GET /api/miniprogram/mine` as a staff dashboard (新建报备 / 公海 / 我的提成) and is not treated as a customer/referrer restricted shell. If a salesperson hits `pages/index`, the home page `reLaunch`es to promotion-records. The shared custom TabBar uses matching neutral/active `tab-earnings` assets for Earnings and Commissions and matching `tab-appointment` calendar-check assets for the enterprise-owner Appointments item; it paints server badge counts and shows `暂时无法读取` when the summary is unavailable. The signed Mine Tab no longer offers subscribe authorization (no「订阅任务通知」row and no login/onboarding/claim subscribe modals); it keeps a「权限」section with WeChat permission management (`wx.openSetting`), plus current identity, account security, and logout below the profile card; the header settings gear is removed and the `settings` route only `switchTab`s back to Mine for deep-link compatibility. Referrer/customer profile cards refresh `/api/miniprogram/profile` from the signed context; `profile-edit` saves nickname plus optional avatar via `POST /api/miniprogram/profile/avatar` (normalized JPEG, signed delivery URL; `.example.com` `MINIPROGRAM_API_PUBLIC_ORIGIN` placeholders fall back to the request host). Designers can also self-serve their WeChat ID and personal QR on `profile-edit`. Focused layout and account-menu regression tests pass. Revocation, deactivation, and version changes expose no invalid-tenant data and never silently fall back to customer |
| Recommendation share | `packages/business/recommendation-share/*` | Read-only shared recommendation and project summary | Limited by share authorization and available assets |

## Platform enterprise registration APIs

`POST /api/miniprogram/codes/resolve` recognizes platform `er_` open-account tokens (including bare 32-char scenes) as `{ kind: 'enterprise_registration', displayName: '家客来企业入驻', valid: true }`. `POST /api/miniprogram/enterprise-registration` requires a Bearer JWT whose authorized phone exactly matches `contactPerson.phone`, validates the active `er_` code, and creates a `pending_approval` / `self_service` enterprise through the same `createSelfServiceEnterpriseApplication` helper as Web `/api/auth/register-enterprise`. Platform review/ops for that application live on Admin `/enterprises` (`POST /api/admin/enterprises/[id]/status`); non-`active` enterprises are not usable as Mini Program staff/referrer workbench contexts. The scan landing is not a sticky home: WeChat recents/home/desktop reopens (`1001`/`1023`/`1089`/`1090`/`1103`/`1104`) with any signed identity leave to role landing; a fresh QR scan or chat-card share still keeps a customer on the form so they can apply. Custom nav reuses the claim-page back chevron (`navigateBack`, otherwise role landing or Mine) so a stack-root scan cannot trap the user. The same recents-leave and back-chevron contract applies to `ej_` onboarding and `rp_`/`sa_` claim landings; a signed workbench identity still leaves the open-account form even on a fresh QR. Ready/success/error/recovery still expose **去登录** as a native button that `reLaunch`s password login after clearing the incidental phone-auth customer session (Mine visitor gateway if relaunch fails); `ACCOUNT_CONFLICT` after approval is an already-account exit; phone authorization that already resolves as a workbench identity leaves the form instead of staying on it; a signed workbench identity leaves to role landing, with password-login fallback if landing fails. Login `mode=password` does not bounce back to the scan page. On the ready form, enterprise name / credit code / contact name must be filled before the primary CTA enables; one tap runs WeChat `getPhoneNumber` then immediately posts the registration (no second “submit” tap). Status: API and `packages/business/enterprise-register/enterprise-register` Implemented; focused contract tests cover scene/`er_` restore, resolve-before-phone, form-gated one-tap authorize-and-submit, phone-match submit, the login/workbench exit, recents reopen leaving signed scan landings, stack-root back, and post-approval phone-auth leaving the form. Authenticated `390x844` native-capsule visual QA remains pending. After platform approval the contact phone logs in as `enterprise_admin` with initial password `123456`; approval also links that phone's existing Mini Program user to the new admin account. Approval SMS and in-app progress lookup remain out of scope.

## Formal surveying

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
must follow that contract. Successful top-bar Save (`onSaveDraft`) persists the
draft then navigates back; cloud failure stays on the editor. Closed `spaces` written by `confirmClosure`,
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
(`drawCursorGlyph` + `icons/cursor-reticle.png`). The drag magnifier overlays a small green
crosshair at its centre and does not magnify that glyph. During that wall-drop wait (`wallSnapPending`), the
canvas still pans and pinch-zooms; only a short tap on a wall or vertex places
the cursor. A short tap on a closed-room fill selects that space during the same
wait (`selectSpace`); the wall/vertex toast appears only when neither snap nor
fill hits. In guide mode that reset-cursor state immediately
shows the Xiao K place-next-start tip even when closed-room dimension labels
fill the canvas; the dock-guide layout softens or force-places rather than
hiding the tip.
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
vertex or closure snaps may change at most one axis and must not copy an
off-axis vertex onto the orange preview; the wall-drag lens reports the actual
snap type and shows a small green crosshair rather than the canvas Fig.1 reticle. Adjacent red edges
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
wall-thickness notch on the outer face. This derived Canvas projection does not
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
- Staff workbench: `GET /api/miniprogram/workbench` accepts `period=week|month|year|custom`
  plus optional Shanghai-calendar `from`/`to` (`YYYY-MM-DD`, inclusive) for custom ranges.
  Enterprise owners receive store-wide `dashboard` five-card KPIs and may include签约金额
  on the signed card; designers/measurers receive the same card shape with personal
  attribution (`assignedTo` / `measurerId`). Response includes `period`, `dashboard`,
  `signedCount`, and `signingRate` (`converted` count via `convertedAt` ÷ same-window
  new leads; `null`/`—` when the denominator is 0). Hero `已交付` remains active
  publication count and is separate from the signed KPI.
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
  `getwxacode`.
  its 32-character `scene` carries the token digest and
  the onboarding page restores the `ej_`/`rp_` prefix before resolution
  and then uses the existing onboarding API. The promotion display route loads
  a protected WeChat Mini Program code for the current referrer membership.
  Design 09 custom-nav presenters (`promotion-service-code`,
  `staff-activity-code`, `enterprise-join-codes`) reuse the claim-page
  capsule-safe back chevron: `navigateBack` when a previous page exists,
  otherwise `navigateToRoleLanding` so stack-root custom-nav landings can return
  to the role home. Promotion and staff-activity presenters already share into
  the claim route; the dual join-code page adds the same 09「一键分享」CTA on an
  active code, opening `onboarding` with the current `ej_` token.
  The anonymous claim route
  classifies and audits opaque tokens and issues a short-lived pending source
  without creating a lead, then lands the customer on the phone-authorization
  state (skipping the historical confirm screen). That phone-auth hero never
  renders a renovation-company name for referral or staff-activity scans; the
  staff-activity presenter may still show the enterprise name. When a designer
  opens the activity code without a WeChat ID or personal QR,
  `GET /api/miniprogram/staff-activity-code` returns `designer_profile_incomplete`
  (403); the page shows「去完善资料」into `profile-edit`, reloads on return, and
  lets the error-state QR stage grow while resetting native `button` width so the
  CTA stays inside the white card instead of overlapping the scan plaque on OEM
  Android WebViews. Staff/referrer onboarding, enterprise-register, login,
  referrer-workbench, Mine「编辑资料」, free-design claim, and other native
  `button` CTAs wrap icon+label in an inner view and/or reset width/padding/`nowrap`
  so ColorOS/OnePlus cannot wrap the last character or overflow a compact chip.
  Existing in-flight attribution
  restores design-14 with a dedicated Xiao K crop, clipboard service card, and
  retention banner; staff/referrer onboarding ready and recovery states restore
  designs 16/17 with door Xiao K crops. Customer
  authorization with `Idempotency-Key` atomically creates the active attribution,
  lead, and assignment; concurrent or repeated scans cannot replace an open
  project. Phone-authorized users can
  join one staff enterprise or up to three referrer enterprises by default;
  leaving a membership disables its promotion token and invalidates old JWTs.
- Customer projects, referrer progress, and design publication: `GET /api/miniprogram/customer-projects` lists only unarchived projects owned by the current `customer_user_id` and feeds Service-home featured ranking plus the multi-project switcher; the `customer-projects` page is a redirect shell only. The archive custom-nav back uses `navigateBack` when a previous page exists, otherwise `switchTab` to Service home so share, subscription, and redirect-shell landings are not a dead end. `GET /api/miniprogram/customer-projects/[leadId]` returns project identity fields (`heroTitle`, `navSubtitle`, `areaLabel`), the enterprise, designer (`wechatId` plus signed `wechatQrUrl` when present), current operational appointment (active confirmed outranks expired or past-end rows), completed v4 floor-plan summary with `previewEndpoint`, `featuredScheme`, and `publishedSchemes` (named conversation albums plus an 其他效果图 bucket for Mini Program singles without a workflow; albums are ordered by first customer-visible publication via `firstPublishedAt`, so round chips stay stable after later merge updates; `publishedSchemes[].finalized` marks the finalized album, `featuredScheme` prefers the finalized workflow otherwise latest activity, and the service-archive delivery header shows **已定稿** when finalized). Service-archive「微信联系设计师」and Service-home「专属设计师」open a shared contact sheet that prefers the designer's personal WeChat QR (long-press recognize / preview) with clipboard WeChat-ID fallback and a search-add hint; the Mini Program cannot auto-add personal WeChat friends. Published images and the formal floor-plan preview are API-base-relative as `/miniprogram/customer-projects/[leadId]/published-generations/[generationId]/image` and `/miniprogram/customer-projects/[leadId]/formal-floor-plan/preview`; the Mini Program attaches its `/api` base URL once and reads the protected bytes under the same customer identity. Those bytes are stored under `wx.env.USER_DATA_PATH` keyed by lead + floor-plan id/`updatedAt` or generation id, so Service home, the service archive, the AI folio, and lead-detail reuse the same local file; a later `onShow` JSON refresh on the archive keeps already-rendered images instead of blanking them after `wx.previewImage` or returning from a child page. Customers and staff open the read-only `packages/business/customer-ai-schemes/customer-ai-schemes` folio over multi-round `publishedSchemes` (customer aggregate vs `GET /api/leads/[id]`); the page has no generate, publish, or edit actions. The service-archive featured delivery block (header plus preview, including the visual `详情` chip) navigates there directly with no action sheet. Customer save/share on the service archive and the customer AI folio opens `components/scheme-share-poster` (brand poster: scheme image + title + 家客来 logo, no mini-program code), saves to the album, then shares the image via `wx.showShareImageMenu`; both pages hide capsule page-forward and do not use `open-type="share"` / `onShareAppMessage`. `GET /api/miniprogram/referrer-progress` and `GET /api/miniprogram/referrer-earnings` authorize against the JWT's active membership; earnings rows follow the current commission `beneficiaryUserId` and `payableAmount` and return only masked service facts and the referrer's own commission records. `GET /api/miniprogram/staff-earnings` authorizes a signed designer or measurer and lists that user's own same-role lead-commission rows for the current enterprise. `GET /api/miniprogram/enterprise-commissions` authorizes a signed enterprise owner and lists the current tenant's unarchived lead-commission ledger grouped for phone display, with payable/paid/voided totals matching Admin `/lead-commissions`; `POST /api/miniprogram/enterprise-commissions/mark-paid` marks payable rows paid with the same repository contract and Mini Program `staff._id` as `paidBy`. The assigned designer can publish or withdraw only succeeded generations belonging to their lead, while the enterprise administrator can manage the tenant; withdrawal retains the generation but immediately removes customer visibility. Admin workbench albums use `POST /api/leads/[id]/ai-scheme-publications` with merge publishing: within the same `workflowId` the selected images are merged/updated into the existing active customer-visible publications, so the featured scheme's `published-grid` updates incrementally and unselected already-confirmed images remain visible until explicitly withdrawn/deleted; re-selecting an already-published image updates title, `sortOrder`, and `updatedAt` but does not rewrite `publishedAt`.
- Manual lead assignment: `POST /api/leads/[id]/assign-staff` is Mini Program
  JWT-only for enterprise admins (`requireMiniProgramEnterpriseAdmin`); body
  `{ designerId?, measurerId? }` with at least one id; `assignLeadStaff` fills
  only missing roles via `ReferralLeadRepository.assignStaff`, rejects overwrite,
  writes `leadAssignmentEvents` with `assignment_manual` / `assignment_manual_pending`,
  and clears `assignment_pending` when both roles are present. Lead detail opens
  `GET /api/miniprogram/enterprise-staff?role=` for eligible roster rows and
  submits this route; Admin `/leads` **重试派单** stays automatic-pool only.
  Focused contract tests cover the route handler and repository fill/reject paths.
- Staff floor-plan preview on lead detail and the shared customer list: completed
  formal v4 plans expose `plan.previewUrl` (`GET /api/floorplans/[id]/preview`);
  enterprise admins, the assigned designer, and the assigned measurer load bytes
  through `fetchProtectedImage` and open full size with `wx.previewImage` (never
  `surveying-editor`). List thumbnails prefer that protected endpoint, then
  Kujiale `externalSource.previewUrl`, then CSS wall segments. Focused contract
  tests cover preview endpoint resolution and protected-image loading.
- Leads, floor plans, measurements, devices, AI, commissions, promotions, and
  notifications use their corresponding tenant-aware API families. Designer and
  enterprise-administrator AI scheme workbench reads use the Mini Program Studio
  facade under `/api/miniprogram/ai/studio/*` (bootstrap, leads, workflows,
  creation tasks/batches/retry, assets, prompt categories/templates with
  category+search filtering, cover enlarge-before-apply (prompt and recommended model only; the cover is not cloned as a reference image), a locked **控制图** thumbnail in the scheme-studio reference row (bound whole-plan snapshot, or `?roomId=` crop matching the batch's first reference; `GET /api/miniprogram/ai/studio/workflows/[id]/floor-plan-preview` forwards that `roomId`), and a floating
  mobile-AI composer dock with「出图设置」sheet in the scheme-studio
  template/composer surface, prompt assist, and signed generation/floor-plan preview URLs).
  AI design space scope is shared with Admin. The Design tab remains the
  **creation entry**; `recipe-project` follows Admin workbench selection (customer,
  then scheme conversation (cards use a signed cover of the latest confirmed
  image, otherwise the latest succeeded generation, else the folio placeholder),
  then apply-to: default `whole_floor_plan`, or
  `single_room` with required `roomId`);   `scheme-studio` is the **scheme archive and continuation** whose composer apply-to picker (dock chip +「出图设置」) posts the same `targetScope`/`roomId` as Admin. Closed-room options come from the scheme-bound formal v4
  survey graph (`sourceFloorPlan.rooms` on `GET /api/miniprogram/ai/studio/workflows/[id]`).
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
  instead of treating a locally generated date list as authoritative. Customer
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
- Graph and Canvas sources are `miniprogram/utils/surveyWallGraph.js`,
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`, and the
  surveying dimension/solid planners.
- BLE integration is `miniprogram/utils/bluetooth.js`; protocol semantics come
  from the repository vendor document. Enterprise connect still calls
  `POST /api/devices/verify-binding` (enterprise ownership; MAC identity is
  compared after stripping separators). iOS discovery often omits GAP `name` on
  the first packet, so scan uses `allowDuplicatesKey: true` and resolves
  `LDMStudio` from `localName`, Complete Local Name AD (`0x09`), or
  manufacturer `advertisData` ASCII. `verify-binding` also matches a compact
  advertisement hex payload against the stored MAC so an iOS UUID `deviceId`
  can still authorize. Platform enroll uses
  `scanBLEForEnrollment` (multi-device scan, MAC only, no connect) plus
  `GET/POST /api/miniprogram/devices` (batch assign via `devices[]`). Discovery
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
  devices permission gap instead of toasting「请打开手机蓝牙」. Adapter-open
  failure, scan timeout, discovery failure, and Android permission denial
  invoke the connect callback with `false` so `ble-connector` clears its
  loading lock; closing the sheet during search calls `cancelBLEDiscovery`
  and stays dismissible.

## Visual QA Record

Appointment-detail embeds the availability picker on-page when `canReschedule` (shared helpers in `utils/appointmentSlotPicker.js`): 5-day window with prev/next paging, slot selection, optional staff reason, and a full-bleed sticky cancel|confirm bar with frosted page-tone background (≈0.9∶1.3 flex + 20rpx gap, shared 26rpx centered labels; confirm full-width when the role cannot cancel; dynamic「确认改期至…」label; disabled until a slot is selected (mint `--action-disabled-bg`, not WeChat `#f7f7f7`); page `padding-bottom` 200rpx clears the bar). Staff `开始量房`/`确认完成量房`, `修改服务地址` ∥ `一键导航至量房地点` (equal-width pill secondary row + 16rpx gap with 📐/✏️/📍), and community sync stay in a scroll secondary region so reschedule owns the sticky primary. `appointment-reschedule` is a compat `redirectTo` shell to detail (mode mapping: absent/`customer` → customer detail; `internal` → staff detail). `POST /api/appointments/[id]/address` and `POST /api/appointments/[id]/internal-reschedule` authorize Mini Program staff by `staff._id` before Admin JWT. Measurers and enterprise owners see `开始量房`/`继续量房` until the linked lead has a completed formal v4 surveying floor plan with at least one closed space; only then does `确认完成量房` appear. Completing an appointment remains server-gated with the same rule, otherwise `POST /api/appointments/[id]/complete` returns `appointment_survey_required` (409). The measurer-unavailability list card uses a compact inline delete control, and the measurer-calendar unavailability card keeps its timer icon inline with the title. Spec: `docs/superpowers/specs/2026-08-21-appointment-detail-inline-reschedule-design.md`; refreshed authenticated `390x844` capture is still pending.

On 2026-08-20, the referrer workbench enterprise selector removed index-based fixed widths: each enterprise pill now takes its natural single-line width in the existing horizontal scroller, so a long enterprise name cannot overlap the next membership or the add-enterprise control. Primary labels and business values on the workbench are `24–28rpx`; explanatory copy is `20–22rpx`. Add enterprise now opens the native QR scanner, accepts only the existing onboarding route with a `token` or `scene`, and hands the scanned value to the existing server-validated onboarding flow; scan failures, invalid codes, and navigation failures receive explicit feedback, while cancellation leaves the user on the workbench. The API, membership switching boundary, and role permissions are unchanged. Authenticated `390x844` host capture remains pending because the current DevTools window has no verified automator endpoint.

## Maintenance

### Role entry tightening

Legacy login responses with `role: user` are normalized to the `customer` context so cold launch cannot render the old floor-plan shell; remaining packaged promotion, commission, inspiration, and recommendation deep routes are explicitly capability-mapped instead of being implicitly allowed.

Customer and referrer Mine retain account, identity, and security controls but no longer render the legacy floor-plan list, create-survey, or start-survey actions. The referrer TabBar now exposes the contractual `Promotion/Progress/Earnings/Mine` destinations directly. Designer and measurer TabBars expose the same `Earnings` destination (`staff-earnings`) for own lead-commission rows. The enterprise-owner TabBar exposes `Commissions` (`enterprise-commissions`) as a tenant payout ledger with payable/paid/voided totals and payable-only「已线下打款」; it reuses `LeadCommissionRepository.markPaid` and does not port Admin amount/beneficiary adjust. Designer, enterprise-owner, and customer lead details hide formal-survey edit/create/delete actions; only a measurer can enter the sole formal editor from an assigned task. Lead creation is exposed only to the enterprise owner and writes `manual_entry` with automatic designer/measurer pool assignment. Booking, appointment-detail, and reschedule deep links are capability-mapped for customer, designer, measurer, and enterprise-owner contexts, and the shared `openSurveyingEditor` helper performs a second signed-context check.

When a route, API, permission, data contract, status, limitation, or visual
source changes, update its row and the Chinese mirror. Keep one current row per
route in the restoration ledger. Do not append date-based implementation notes,
superseded references, or duplicate test transcripts.

Chinese mirror: [miniprogram-system-modules.zh-CN.md](./miniprogram-system-modules.zh-CN.md)
