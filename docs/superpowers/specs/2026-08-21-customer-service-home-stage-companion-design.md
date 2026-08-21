# Customer Service Home — Stage Companion Redesign

**Date:** 2026-08-21  
**Status:** Implemented / ready for QA  
**Surface:** Mini Program customer role · `pages/index/index` (Service tab)  
**Related routes:** `packages/business/customer-project/customer-project`, legacy `packages/business/customer-projects/customer-projects` (deep-link redirect shell only)

## Problem

1. Under「我的服务」, the card title showed `serviceStageLabel` (e.g.「已匹配测量员」) while the body repeated `appointmentSummary` twice, producing duplicate customer-facing copy.
2.「查看全部项目」opened the intermediate「我的项目」index (`customer-projects`); customers had to tap again to reach「我的服务档案」(`customer-project`). The intermediate page should not exist as a product surface.
3. Approved raster `01-customer-workbench.jpg` assumes floor-plan and scheme thumbnails inside the hero. Early stages have no real media; empty slots or fake placeholders would look broken or imply false progress.

## Goals

- Redesign the customer Service home around a **stage companion** hero with Xiao K as **空间服务向导**.
- Keep the hero visually full before survey/scheme media exist.
- Primary navigation: home → service archive (`customer-project?leadId=`), no list middle page.
- Fix duplicate copy via strict text layering.
- Support multiple in-progress services without restoring the list page.

## Non-goals

- Redesigning staff/referrer workbenches.
- Changing `customer-project` archive visual contract (design 02 remains).
- Inventing fake floor-plan or scheme artwork for empty slots.
- Adding a customer「项目」TabBar item.
- Removing `GET /api/miniprogram/customer-projects` (still required for ranking and the switcher).

## Design decisions (locked)

| Decision | Choice |
| --- | --- |
| Empty / early media | **A — Stage companion card**: inset is Xiao K + stage copy + micro-progress until real previews exist |
| Multi-project | **2 — Featured hero + switcher**: show highest-urgency service; if N≥2 projects, show「还有 (length−1) 个进行中的服务 / 切换」sheet on home |
| Project index page | Retire as product UI; keep route as deep-link redirect shell |
| Brand IP | Xiao K = 空间服务向导 only on this page (identify + role; stage path as light mechanism) |

## Information architecture

### Header

- Brand lock:「家客来 · 服务向导」+ professional service cue
- Existing scan / notification utilities unchanged in meaning

### Hero (featured service)

1. Title:「我的装修服务」
2. Subtitle: **only** `appointmentSummary` (one customer-readable status sentence)
3. Inset panel:
   - **Media slot:** Xiao K stage pose by default; replace with formal floor-plan preview and/or published scheme thumb when available (never invent images)
   - **Inset title:** current stage status aligned with the micro-progress pills（匹配 / 预约 / 量房 / 方案）, e.g. confirmed appointment →「已预约上门量房」— never「下一步：{CTA}」; CTA labels stay on the primary button only
   - **Inset helper:** one short companion line (Xiao K voice)
   - **Micro-progress pills:** 匹配 → 预约 → 量房 → 方案 (done green / current orange / upcoming gray)
4. CTAs:
   - Primary: driven by `nextActionKind` (`预约上门` / `改期` / `重新预约` / `等待派单` / `我的服务档案`). Runtime `nextActionKind` is authoritative over the illustrative stage table.
   - Secondary「我的服务档案」only when primary does **not** already open the archive (i.e. primary is book / reschedule / rebook / wait). If primary is already archive (`view_project` / equivalent), render **one** full-width「我的服务档案」button and omit the secondary.
5. Customer-facing label「看项目」→「我的服务档案」

### Multi-project strip

- Visible only when unarchived owned projects `length ≥ 2`
- Copy:「还有 N 个进行中的服务」+「切换」, where **`N = length - 1`** (count excluding the featured hero). Example: 2 projects →「还有 1 个进行中的服务」
- Opens an in-page half-sheet list (neutral service name, stage summary, updated time); list may include all projects so the user can re-select the current featured item
- Selecting a row updates the featured hero; does **not** navigate to `customer-projects`

### Secondary row

- Two shortcut cards:「预约量房」「专属设计师」
-「预约量房」: if `nextActionKind` is `book` / `rebook` / `reschedule`, open the matching booking/reschedule flow; otherwise open the service archive (or hide the card when there is no `leadId`)
-「专属设计师」: if designer contact exists on the featured project, open archive contact/WeChat entry already defined on design 02; otherwise soft copy「设计师匹配后可联系」with tap → archive (no fake chat)
- Do not invent phone numbers, names, or booking slots on the home card itself

### Removed from home

-「我的服务」duplicate list card (title + repeated body that caused bug 1)
-「查看全部项目」link to the index page

### Empty home (zero projects)

- Hero explains no active service; CTA points to claim / known entry paths already in product — do not invent a new acquisition funnel in this redesign

## Stage → Xiao K / CTA / media

| Stage keys | Xiao K action | Primary CTA | Inset title (current step) | Inset media |
| --- | --- | --- | --- | --- |
| `claimed`, `assignment_pending` | 陪你等待匹配（inset helper「匹配完成后可预约上门」; never repeat CTA「等待派单」） | 等待派单 (weak/disabled) | 服务匹配中 | Xiao K only |
| `measurer_assigned` | 引导预约 | 预约上门 | 待预约上门量房 | Xiao K only |
| `appointment_confirmed` | 日程提醒 | 改期 or 我的服务档案 | 已预约上门量房 | Xiao K only |
| `appointment_expired`, `awaiting_rebooking` | 协助重约 | 重新预约 | 需重新预约量房 | Xiao K only |
| `appointment_in_progress` | 测量进行中 | 我的服务档案 | 上门量房进行中 | Xiao K only (unless preview exists) |
| `survey_completed` | 展示户型 | 我的服务档案 (single CTA) | 量房完成 · 可进服务档案 | Floor-plan preview preferred, else Xiao K |
| `design_published`, `converted` | 成果交付 | 我的服务档案 (single CTA) | 方案已发布 · 我的服务档案 | Prefer scheme thumb; if both floor-plan and scheme exist, show **dual thumbs** (plan + scheme) like design 01; never leave an empty second slot — if only one exists, single media + Xiao K or single media alone |
| `closed` | 说明已结束 | none / archive if still readable | 服务已结束 | Xiao K only |

### Copy layering rules (hard)

1. Hero subtitle = `appointmentSummary` only (customer-readable status). For `claimed` / `assignment_pending` use「正在为您匹配设计师和测量员」— never staff operational copy such as「补齐可用设计师或测量员后重试派单」
2. Inset title = current progress-step status (aligned with 匹配/预约/量房/方案); must not be「下一步：{CTA}」and must not repeat the subtitle  
3. Do not surface `serviceStageLabel` alone as a list-card title on home  
4. Micro-progress reflects derived stage, not marketing copy  
5. Primary CTA keeps the action label (`改期` / `预约上门` / `等待派单` / …) on the button only; inset helper must not repeat that CTA label. Dual hero CTAs share one `28rpx` label size.

## Routing and API

| Asset | Fate |
| --- | --- |
| `GET /api/miniprogram/customer-projects` | **Keep** — home ranking, featured selection, switcher data |
| `customer-project?leadId=` | **Keep** — sole service archive UI (design 02) |
| Home → archive | Direct `navigateTo` with featured / selected `leadId` |
| `customer-projects` page | **Retire product UI**; `onLoad` redirects: prefer featured archive if any, else `switchTab` Service home |
| Other entry points (`free-design-service`, index helpers, role-workbench secondary) | Stop navigating to the list page; use archive or in-home switcher |

Featured ranking continues to use the existing customer urgency order (expired / rebook / in-progress / confirmed / survey / design / measurer assigned / pending / claimed / converted / closed).

## Visual / asset notes

- Follow `miniprogram/DESIGN.md`, tokens, and `docs/design/jiakelai-brand-ip-guidelines.md`
- Prefer existing packaged Xiao K assets where they match the stage action; if a required pose is missing, stop and ask rather than inventing a non-IP substitute
- Typography floors and capsule safe area apply at `390x844`
- No WebP in Mini Program runtime

## Documentation updates (implementation handoff)

- Bilingual design restoration ledgers: replace `pages/index/index` customer row with this stage-companion contract; mark `customer-projects` as deep-link redirect only
- Bilingual Mini Program module inventories: Service home entry goes straight to archive; list API described as home/switcher source
- Do not treat `01-customer-workbench.jpg` dual-thumb hero as the empty-state authority; this spec supersedes that gap for early stages

## Success criteria

- Measurer-assigned home shows one status sentence, not duplicated body lines
- Tapping archive CTA / secondary CTA opens `customer-project` without visiting the list page
- Opening legacy `customer-projects` path never paints the old list UI
- Early stages keep a filled inset via Xiao K; post-survey/design stages prefer real previews
- N≥2 projects expose switcher; N=1 hides it

## Out of scope for first implementation slice (unless discovered necessary)

- New raster generation for every Xiao K pose (reuse / ask)
- Redesign of design 02 archive internals
- Backend changes to stage derivation algorithms (consume existing `serviceStage` / `nextActionKind` / summaries)
