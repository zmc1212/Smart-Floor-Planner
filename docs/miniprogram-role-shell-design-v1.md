# Mini Program Five-Role Information Architecture and Role Shell Design Source v1

Status: `Implementation authorized; phase in progress`  
Scope: Referral-network and appointment plan, phase 12  
Mode: Operate (high-frequency business work)  
Target viewport: iPhone 13 Pro, `390x844`, including the native WeChat capsule and bottom safe area

## 1. Delivery boundary

This file is the production UI design source for phase 12. The user explicitly authorized a
role-shell implementation that extends the current Mini Program visual language. Implement each
route against this source, then replace its single row in both restoration ledgers only after
`390x844` host-window verification.

This phase fixes the five role landings, allowlisted dynamic TabBar, identity selection and
recovery states, role-specific first-run/data/empty/loading/retry/forbidden states, safe-area
geometry, and mappings to existing deep-route sources. It adds no fake data or replacement for
the approved appointment, customer-project, promotion-code, or formal-survey designs. Phase 14
adds only the signed, server-owned workbench read aggregate needed by these shell entries; it does
not create a new customer, appointment, survey, design, or earnings business contract.

The implementation reuses the four static Mini Program Tab routes as signed role shells: customer
`Service/Projects/Mine`, referrer `Promotion/Progress/Earnings/Mine`, designer
`Workbench/Customers/Design/Earnings/Mine`, measurer `Workbench/Customers/Earnings/Mine`, and enterprise owner
`Operations/Customers/Appointments/Mine`. Every workbench reads only the server aggregate for the
signed identity; measurers enter the formal editor only from assigned tasks, and blank or simulated
tabs remain prohibited. The role scene reuses the exact standalone Xiao K asset referenced by the
approved role-shell board, `miniprogram/images/page-ip-v3/mine.png`; it is a complete asset, not a
cut from the board.

## 2. Visual direction and safe-area contract

- Use a warm-white page, one pale-mint business scene, and a real-data work area. The scene is
  about `18%-24%` of the first viewport and is never a marketing hero.
- Xiao K has one job per identity: customer service guide, referrer promotion steward, designer
  case coordinator, measurer partner, enterprise dispatch observer, and identity custodian in Mine.
- Use the F1 full body and F3 spatial transformation as information metaphors. Keep lists,
  metrics, and buttons native. Never use screenshot slices, full-page image backgrounds, circular
  mascot bases, decorative glows, or unimplemented shortcuts.

| Region | Constraint |
| --- | --- |
| Native capsule exclusion | Treat `x=270..390px`, `y=0..88px` as unavailable. No title, back, save, switch, or other control enters it. |
| Custom navigation | Use runtime `navigationTop/navigationRight`; start title/actions to the left of the capsule. Static reference line is `y>=96px`. |
| First-viewport scene | About `18%-24%` below custom navigation, with the first real data area or sole CTA visible. |
| TabBar | Fixed bottom bar; reserve at least `128rpx + env(safe-area-inset-bottom)`. The gesture area carries no text or controls. |
| Type | Primary copy and values `>=24rpx`; supporting text `>=20rpx`. |
| Touch | Interactive controls are at least `44px` logical height; disabled state explains why. |

## 3. Five landings

| Role | Runtime landing | Metaphor and first task | Allowed real data | Must not appear |
| --- | --- | --- | --- | --- |
| Customer | `/pages/index/index` | Service guide opens “my renovation service”: stage, appointment, next action | Owned service state, appointment, completed v4 summary, published designs | Staff lead pool, BLE, survey editor, AI production, signing/commission management |
| Referrer | `/packages/business/referrer-workbench/referrer-workbench` | Promotion steward opens “enterprise service desk”: choose enterprise, present code | Current membership, active code, masked milestones, own commission state | Phone/WeChat/address, wall graph, internal appointment reason, enterprise rules |
| Designer | `/pages/index/index` (role workbench) | Case coordinator sorts “customers to move forward” | Own assigned leads, appointments, completed plan summaries, own generation/publication state, own commission state | Others’ leads, measurer leave, enterprise commission rules, free survey entry |
| Measurer | `/pages/index/index` (role workbench) | Measurement partner opens “today’s measurement desk” | Own appointments, unavailability, assigned survey tasks, formal-survey entry, own commission state | Design publication, signing, referrer earnings, tenant rules, unassigned customers |
| Enterprise owner | `/pages/index/index` (role operations) | Dispatch observer opens “operations view”: exceptions and approvals first | Tenant exceptions, customer summary, appointment exceptions, existing authorized approvals, tenant payout ledger | Designer/measurer tools inherited implicitly; switch identity for hands-on work |

Because the Mini Program has a small static Tab route set, phase 14 renders enterprise operations at
`/pages/index/index`; `/pages/mine/mine` remains identity and account management.

## 4. Role-allowlisted TabBar

Build the TabBar from `current.capabilities` returned by bootstrap. Client hiding, deep-link guards,
and server authorization must agree. There is no shared center “survey” button; only measurers get
the survey primary entry.

| Role | Items | Capabilities | Badge source |
| --- | --- | --- | --- |
| Customer | `Service / Mine` | `customer.service`, `account` | Server-owned reschedule/rebook counts; failures say unavailable. Service home opens the archive directly; `免费效果图` opens the delivered-scheme folio; `customer.projects` still guards archive/list API access while `customer-projects` is only a redirect shell |
| Referrer | `Promotion / Progress / Earnings / Mine` | `referrer.promotion`, `referrer.progress`, `referrer.earnings`, `account` | Masked milestones and own payout state for the active membership |
| Designer | `Workbench / Customers / Design / Earnings / Mine` | `staff.leads`, `staff.appointments`, `staff.design`, `staff.earnings`, `account` | Own follow-up/appointment/publication state plus payable own commissions; no fake numbers |
| Measurer | `Workbench / Customers / Earnings / Mine` | `staff.schedule`, `staff.tasks`, `staff.earnings`, `account` | Workbench tab aggregates today's appointments; “Customers” tab reuses the shared `leads-management` lead list (role-scoped, no create) for assigned/promoted customers and handoff status. Earnings shows own payable/paid commissions. Formal-survey editor remains reachable only from task context deep links |
| Enterprise owner | `Operations / Customers / Appointments / Commissions / Mine` | `enterprise.operations`, `enterprise.customers`, `enterprise.appointments`, `enterprise.commissions`, `account` | Tenant exception/approval/appointment state plus payable commission count, not employee personal work |

Use brand green and a pale-mint active state, neutral gray elsewhere, and the existing local licensed
icon set. The approved `design-references/tabbar-icons/tabbar-earnings-appointment-v1.png` reference maps
Earnings and Commissions to the paired `tab-earnings` wallet-and-income assets, and the enterprise-owner
Appointments item to the paired `tab-appointment` calendar-check assets; every pair has neutral and active
states with identical geometry. Referrers select an enterprise inside the workbench rather than adding an
enterprise TabBar item.

## 5. Identity selection and recovery states

| State | Required expression | Sole primary action | Data boundary |
| --- | --- | --- | --- |
| `loading` | Confirming current identity with stable skeleton | none; wait for bootstrap | No old-role content or local badge numbers |
| `single-context` | Current role and enterprise/member context | Enter landing | Current valid context only |
| `multi-context` | Grouped identity cards with current marker | Select and confirm switch | Server-returned valid contexts only |
| `referrer-memberships` | One referrer role; enterprise choice inside workbench | Switch signed membership | No cross-enterprise request data |
| `expired` | Session expired and concise reason | Sign in again | Clear stale token; do not expose inactive tenant |
| `revoked` | Identity unavailable and remaining valid identities | Choose valid identity or sign out | Never silently fall back to customer |
| `forbidden-deep-link` | Current identity cannot open this page | Return to role landing | Do not issue forbidden API request |
| `switch-error` | Keep current page and explain failure | Retry switch | Keep current valid token |
| `no-alternate` | One valid identity remains | Return to Mine | No pointless switch flow |

Mine shows current role and enterprise on its first screen. Switching is discoverable there, not hidden
behind a settings gear; a single-role account shows the current identity without a switch affordance.

## 6. Key empty-state sources

Each empty state has one explanation and one real CTA. Xiao K performs the role-consistent action and
never displays locally simulated counts.

| Role/page | Copy direction | Xiao K action | CTA |
| --- | --- | --- | --- |
| Customer service | “No active service yet” | Unroll an empty home path | Open the real service entry |
| Customer project | “Your project appears here after service begins” | File an empty project folio | Back to Service |
| Referrer promotion | “Choose an enterprise you have joined” | Place the code into the enterprise desk | Choose enterprise |
| Referrer progress/earnings | “No service facts/earnings to show yet” | Inspect an empty milestone folio | Back to Promotion |
| Designer customers | “No assigned customers right now” | Sort an empty case file | Refresh |
| Designer design | “Formal surveying is required before design” | Open an unfilled design folio | View customers needing survey |
| Measurer schedule/tasks | “No confirmed schedule/handoff today” | Put away the rangefinder | View unavailability or refresh |
| Enterprise operations | “No exceptions need attention” | Observe a steady dispatch path | Refresh |
| Identity list | “Only one valid identity remains” | Guard the identity card | Back to Mine |

## 7. Deep-route source mappings

The shell owns context and entry only. These deep pages retain their approved sources:

| Route | Existing approved source |
| --- | --- |
| `packages/business/referrer-workbench/referrer-workbench` | `design-references/referrer-network-appointment-v1/phase-5-referrer-workbench-v1.png` |
| `packages/business/promotion-service-code/promotion-service-code` | `design-references/referrer-network-appointment-v1/selected-option-a.png` |
| `packages/business/customer-project/customer-project` | `design-references/referrer-network-appointment-v1/phase-6-customer-project-v1.png` |
| `packages/business/appointment-booking/appointment-detail/appointment-reschedule` | `design-references/referrer-network-appointment-v1/phase-5-designer-appointment-booking-v1.png`, `phase-5-appointment-calendar-v1.png` |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg` |

The shell source pack is `design-references/role-shell-v1/`. This document and its Chinese mirror are
the structural, state, and safe-area text source; no full-page screenshot is packaged in the Mini Program.

### 7.1 Logged-out Mine gateway element ledger

The current approved source is
`design-references/auth/miniprogram-guest-login-jovekore-v2-full.png`. At the
`390x844` baseline, production uses the following intrinsic stack; tall screens
may leave extra page background only after the final trust row and must not open
a viewport-growing gap inside the scene-to-panel reading group.

| Element | Baseline production target | Source / implementation mapping |
| --- | --- | --- |
| Capsule-safe brand lockup | Runtime `navigationTop` + `navigationHeight`; `58rpx` logo and `30rpx` lockup text | Native `brand-logo.png` plus native text, left of the capsule lane |
| Identity-reception scene | `700rpx` high; `<=360px` keeps the same width-normalized proportion instead of shrinking to `660rpx` | Standalone generated `images/home-ip-v1/login-identity-portal-v2.jpg`; no composite slicing |
| Overlapping native panel | `32rpx` side margins; `-34rpx` overlap; `34rpx` radius | Native WXML/Less; warm-white surface and downward soft shadow |
| Heading / helper | `40rpx` / `24rpx`; the heading is not downscaled on narrow screens | Native text; one-line heading target at the baseline and at `<=360px` |
| Identity rail | `104rpx` icon containers, `70rpx` PNG boxes, about `58rpx` visible alpha bounds, `24rpx` labels | Native `个人用户 / 员工 / 推荐人`; the three transparent-padded Lucide-derived PNGs recorded under `docs/icon-sources/mine/` are calibrated by visible alpha bounds |
| Match note | `22rpx` native copy with half-pixel short separators | `登录后自动匹配身份`; informational, not interactive |
| Primary CTA | Full panel-content width, `92rpx` high, `28rpx` label | Sole executable `立即登录` action; keeps existing `goToLogin` route and explicitly clears native button max-width and horizontal margins |
| Trust row / bottom | `22rpx` copy with a `30rpx` shield-check PNG above `env(safe-area-inset-bottom)` | `一个账号 · 多重身份 · 随时切换`; reuses `images/mine-icons/shield-check.png` instead of a CSS pill approximation; no second action |

Focused tests verify static layout, asset signatures, encoded sizes, the
full-width CTA, the shield-check asset, and the `<=360px` guard against
compressing this continuous reading group. Native capsule-host optical QA at
`390x844` and on the user's supplied tall device remains pending a revised
manual runtime screenshot.

## 8. Approval acceptance checklist

- Five landings and TabBar order exactly match the tables; missing capabilities hide entries.
- At `390x844`, titles/actions, capsule, and bottom gesture area never overlap; `<=360px` has no overflow.
- Each role is checked for first-run, populated, empty, loading, retryable error, expired, and forbidden states.
- Badges come only from bootstrap role-scoped counts; unknown/failure is not replaced with `0` or sample data.
- Negative deep links are rejected by client, navigation guard, and API authorization without rendering another role.
- Each implemented route replaces one row in both restoration ledgers and includes a native-host capture.

## 9. Implementation and verification status

The user authorized extension of the current Mini Program style. Phase 12 now implements bootstrap
role-allowlisted navigation, an identity-recovery page that exposes no invalid-tenant data, and
server-owned Tab badges from role-scoped todo counts. Failed counts show `暂时无法读取` instead of a
local zero. Customer Service home, enterprise Operations exceptions, the Appointments tab, measurer
Workbench, and designer WeChat self-service consume the shared `serviceStage`/`nextActionKind`. Each
changed runtime route still needs `390x844` native-host verification before its restoration-ledger
row changes.

Chinese mirror: [miniprogram-role-shell-design-v1.zh-CN.md](./miniprogram-role-shell-design-v1.zh-CN.md)
