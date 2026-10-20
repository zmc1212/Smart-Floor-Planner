# XiaoK Assistant Roadmap

**Current effective plan | consolidated 2026-10-19.** This document maintains one product direction, capability gaps, implementation order and acceptance scope. Existing phase IDs identify capabilities; reuse delivered foundations. Section2 links historical proposals, migrations, model/prompt versions, execution counts and batch results instead of appending “current batch” logs here.

This document maintains development direction and acceptance scope without substituting plans for implementation evidence. Current code, tests and module inventories establish implementation facts; PPT and each route's one latest approved design establish visual authority. Production rollout requires separate authorization.

## 1. Product goals and shared constraints

### 1.1 First service line: professional customer support

XiaoK first answers professional renovation questions: understand the question, retrieve enterprise knowledge and authorized facts from the customer's actual project as needed, explain evidence, tradeoffs and recommendations, and continue follow-up questions. Material association, stage questions and durable issues support this service. Ordinary explanations finish directly; actual verification/handling continues with the team when needed.

For “Will adding a dishwasher now affect the arrangements?”, combine applicable enterprise practices, the actual stage, known appliance needs and effective drawings. Explain known conditions, possible impacts and remaining verification. Missing project facts remain unknown; repeating a stage, listing excerpts or declaring a changed schedule is insufficient.

| Source | Role in the answer | Factual boundary |
| --- | --- | --- |
| Enterprise knowledge | Published, applicable craft, material, service and policy evidence | Preserve origin, pages/passages/tables, units/exceptions, audience, effective version and conditions; upload time does not determine precedence |
| Language model | Understand intent/references, organize evidence, explain principles/tradeoffs and ask natural follow-ups | Separate general advice from enterprise rules; never invent site facts, commitments or formal approval |
| Actual project | Correct project/room stages, needs, records, drawings, issues and handling results | Query under current role permissions with business versions, record/query times and gaps; distinguish planned, actual, completed and accepted |
| Conversation and memory | Continue established objects, originals, preferences, corrections and unresolved questions | Memory never substitutes for business facts, mixes homes/customers or overwrites independent needs |

Keep phase one's conservative excerpt mode; separately accept generated explanations under this plan. Do not copy dynamic project facts into a general knowledge base as a second truth source. Professional explanations bring enterprise evidence and project facts into the same answer. Retrieval/tool success, fixed displayText or excerpt lists alone do not establish comprehensive answering.

### 1.2 Customer experience and team responsibilities

- **Chat first:** customers may ask before providing needs, defer budget, change topic or correct themselves. The five need categories are internal structure, without mandatory questionnaires, progress, summary save/confirmation, reference collection or material forms. Short recaps are optional; preserve existing confirmations/history.
- **Direct photo send:** no classification, room or plan-version selection first. Associate clear context automatically and clarify only gaps/ambiguity. Staff verify classification/ownership without customer reupload. Reference images never write formal v4 geometry; consume formal plans through read-only adapters.
- **Human continuation:** an explicit request submits in the original chat without a material-sharing card, summary/file or phone prerequisite. Separate consent covers telephone contact; declining it still permits in-app service. Reception designers coordinate complex judgments, formal quotes/specific schedules; XiaoK still answers ordinary professional explanations.
- **Consistent modes:** waiting accepts supplements while pausing free AI replies/proactive need questions, showing only real status/deterministic feedback. Customers may cancel back to AI; no late AI after takeover. Staff release returns to waiting; explicit end restores AI. Unavailability never invents presence/response times.
- **Contact rules:** negotiate ordinary communication times in chat without a separate appointment/confirmation workflow. PPT18/21's contact action calls the currently authorized stage employee's live phone; attendance/rescheduling/cancellation is coordinated by phone. Create no site-visit intention and preserve formal surveying appointments.
- **Team responsibilities:** designers review materials, answer and prepare proposal differences; managers arrange members/stages/issues; workers post originals and review/publish records; owners/operations review, coordinate and handle devices/support within permission. Reduce repeated entry across roles; customers do not manage internal tasks, versions, device configuration or refund reconciliation.
- **Shared scope:** one shared XiaoK conversation per enterprise/project for the manager, workers and assigned designers, with the same originals, attachments, drafts and versions. Author/manager/version rules still govern edits/publication. Separate projects and homeowner private consultations; homeowners receive only explicitly published/authorized projections.
- **Low-interruption follow-up:** ask only critical missing stage needs; do not repeat known, asked or deferred questions, and allow topic changes. Photo watches and formal handling are separate. “Tell me when it changes/stop reminders” creates/cancels real watches; WeChat subscriptions are requested separately by scenario.

### 1.3 Facts, permissions and reliability

1. Trace originals, model observations/inferences, explicit customer statements, staff verification, formal approval and publication separately. Corrections retain a supersedes chain and affect only the relevant object/field. Staff checks/model confidence do not establish customer approval.
2. Associations retain resource ID/version or hash, project/room mapping, original message/media, audience, basis, query time and validity. Effective version/publication relations precede similarity/upload time; matching names/similarity do not establish a link. Verify clear relations automatically and clarify ambiguity/conflicts. Missing drawings/stale/conflicting sources still permit supported partial answers with minimal gaps.
3. Discussion, hypotheses and image observations create no formal issue automatically. Actual handling retains one issueId/revision, owner, waiting party, state, evidence and returned result. Reply, publication, customer decision, execution, resolution and closure each follow business conditions. Unassigned stays explicit; replies do not resolve and closure is not engineering acceptance/payment.
4. Obtain necessary explicit decisions for contact, exact public scope, formal versions/costs/schedules and orders/payments/refunds, bound to precise objects/versions. “Okay”, silence and browsing are not approval; replacement versions cannot inherit consent. Decline/defer leaves chat usable; submission/approval/execution/settlement each requires its actual receipt.
5. Server identity/resource relationships and shared tenant mechanisms govern retrieval, media, caches, history, derived memory, tools, jobs and delivery. Removal/disable/revocation/replacement invalidates related access/derived conclusions; source text/instructions cannot change permissions. Use isEnterpriseManagementRole: platform administrators inherit enterprise management in an explicitly selected enterprise without mandatory project employment/membership.
6. Conversations may precede leads/projects and retain identity through controlled association; leadId/projectId are not conversation identity. Reception never grants all enterprise private chats/project materials. Keep origin, work author, receptionist, owner and commission basis separate.
7. Reuse run/job/step/outbox, Worker leases, short transactions, source/business versions, idempotency and accounting. Model/storage network calls stay outside transactions. Bound loops by rounds/time/budget; reconcile unknown writes using the original operationId. Recovery/redelivery never duplicates effects; checkpoints do not provide external exactly-once.
8. Bind same-turn text/images explicitly. Resolve authorized media server-side, send necessary data only to tenant-permitted providers and never fetch arbitrary model/client URLs. Use versioned content blocks with text fallback; execute no model HTML/arbitrary routes. Recheck sources/revision/human mode before committing replies. Disclose missing vision capability; one image cannot establish load-bearing structure/exact dimensions/hidden quality. Integrate actual image/tool/structuredOutput/streaming/usage/context capabilities and avoid logging originals/audio/full conversations by default.
9. Record provider/model, prompt/policy, input references, latency, errors and usage; include images in budgets and keep unknown costs unknown. Select relevant two-sided history, facts, corrections, issues and evidence within context budgets rather than resending everything. Retention covers summaries/observations/checkpoints/debug copies. Audio/transcripts/corrections reuse the same core; image generation remains in the existing AI workbench.
10. Durable issues distinguish verification/supplement, team, customer-decision and execution waits, resolved/closed and paused/cancelled states with real transition evidence. No agreed deadline means no overdue claim. Actual stage/material/version/member/mode/result events drive continuation/delivery through controlled message append, without fabricated user turns or requiring an open page. Cancellation, rescheduling and revocation prevent stale work revival; delivery failures recover without widening audiences.

### 1.4 Technical direction and open-source practices

Reuse the current LangGraph JS and business adapters, combining retrieval, model explanation, controlled tools and deterministic business steps. Framework state never replaces database authority for jobs, permissions, provenance and business facts. Integrate incrementally with conversation/history compatibility, enterprise switches and rollback. Register business contracts at the core and assemble cross-module dependencies at the application layer, without a second job/permission/truth system.

The [Agent engineering plan](./xiaok-agent-engineering-plan.md) owns existing foundations, remaining solutions and open-source adoption boundaries for context/memory, task state, objects/versions, rules/tools, recovery/human continuation, permissions, quality and model costs. Ingestion/retrieval details remain in the [enterprise knowledge plan](./xiaok-enterprise-knowledge-plan.md), without repeating them here.

Before extending, review maintained source, tests and provider issues, pinned versions, licenses, data boundaries and costs; adopt only after configured-model checks for the phase's cases. Framework migration/rewrites need concrete benefits. The dedicated plan neither introduces another execution system nor upgrades implementation status.

## 2. Current capabilities and gaps

### 2.1 Capability summary

Labels: `Implemented` means an evidenced bounded loop, `Limited` means capability gaps remain, and `Placeholder` means the business loop is undelivered. This table locates planning work;2.2 owns current API/scope/acceptance facts. This revision reruns no checks and upgrades no status; labels, mocks or success messages do not establish implementation.

| Capability | Current position | Remaining gap |
| --- | --- | --- |
| Enterprise knowledge and comprehensive professional answers | Limited: publishing/retrieval, citations, conservative answers and evidence-bound synthesis code exist | Extend professional structure/ingestion, applicability and retrieval quality under the knowledge plan; validate combined explanations/follow-ups |
| Text, images, context/memory and tools | Limited: bounded Agent, image observations, correction chains, business reads and recovery exist | AG-01–09 cover budgets/compaction/recall, tasks/objects, rules/tools and quality; audio integrates separately |
| Material association | Limited: own statements, v4 plans, published records and consented PPT23 materials/same-issue returns have foundations | Clear project/room/effective-drawing retrieval, ambiguity correction, gaps and per-claim evidence; queries alone do not explain |
| Sustained follow-up | Limited: stage questions, query_followups, shared issues and bounded returns exist | Cross-day/stage waiting parties, event continuation, original-consultation return and recovery using existing issues |
| Human continuation | Limited: chat/staff reception has a bounded implementation | Connect answers, materials and issue context while preserving waiting/takeover/cancellation and permissions |
| Site facts and shared chat | Limited: employee onboarding, shared three-role entry, stages/live phones and bounded S04 exist | Connect professional site-context answers and remaining materials/collaboration; native visual coverage follows the ledger |
| Portfolios, recommendations and public sites | Limited: bounded P2A.3, P2C author/customer and P4B consent/review loops exist | Preserve effective sources/versions, regional/provider limits; schedule content/distribution extensions as needed |
| Formal proposals and site handling | Limited: exact P5 versions/customer decisions exist; phase two records current PPT38 execution/resolution/closure acceptance | Reuse delivered handling, finish scoped acceptance and connect professional/cross-phase service; no new version system |
| Manager/owner operations | Placeholder: planned P6 digest/coordination loop remains undelivered | Evidence-based multi-project digests, drill-down questions and authorized coordination |
| Audio and managed video | Placeholder: P2M.4 audio/P4C device-service loops remain undelivered | Add ASR/original audio and real devices/orders/playback/support/refunds by batch without blocking text/images |

### 2.2 Sources of truth and historical references

Each entry owns its stated responsibility; the roadmap maintains future targets/order. Historical section numbers/manual-test instructions are not new development gates. Use this plan's current experience and section4 acceptance rules while preserving historical unverified results.

| Information to verify | Existing authoritative location/reference |
| --- | --- |
| APIs, models, permissions, routes and limits | Current code/tests plus [Admin inventory](./admin-system-modules.md) and [Mini inventory](./miniprogram-system-modules.md) |
| Phase-one knowledge, tenancy, durable jobs, accounting/retention and checks | [Phase-one contract](./xiaok-assistant-phase-1.md) |
| Phase-two Agent, reception, portfolios, construction, public consent, PPT23/P5 and batch/recovery evidence | [Phase-two contract](./xiaok-assistant-phase-2.md) |
| Cross-cutting Agent challenges, existing/remaining scope, priorities, phases and AG-* acceptance | [Agent engineering plan](./xiaok-agent-engineering-plan.md); owns horizontal solutions, not business progression or implementation contracts |
| Future knowledge structure, ingestion/retrieval, operations and K-* acceptance | [Enterprise knowledge plan](./xiaok-enterprise-knowledge-plan.md); this roadmap owns service priority, with knowledge details maintained only in the dedicated plan |
| Historical foundations, handoff and repeatable context | [Existing handoff](./xiaok-assistant-handoff.zh-CN.md) and [foundation manifest](./xiaok-assistant-foundation-manifest.json); these do not rewrite current targets/acceptance |
| Product scenarios and original screens | [家客来小K装修服务功能方案.pptx](./装修施工标准手册制度规范/家客来小K装修服务功能方案.pptx):1–39 main pages,40–88 enlarged appendix; inspect details with their main pages |
| Per-route design source, assets, visual QA and restoration state | [Restoration ledger](./miniprogram-design-restoration-ledger.md), [Mini design rules](../miniprogram/DESIGN.md) and [brand/IP rules](./design/jiakelai-brand-ip-guidelines.md); roadmap/old boards never replace approved sources |
| Acquisition/appointments/commissions, subscriptions and deployment | [Referral/appointment plan](./referrer-network-appointment-development-plan.md), [claim/racing contract](./lead-claim-racing.md), [WeChat subscription templates](./miniprogram-subscription-notification-template-baseline.md) and [remote development boundary](./remote-development.md) |

## 3. Implementation order and business integration

### 3.1 One service progression

This chat now owns both plans, shared interfaces, integration and acceptance. The split below is by domain, without requiring parallel chats or equal changes in both plans. The user authorizes successive complete business batches by actual dependencies: implement, integrate necessary clients, automate checks, update bilingual documentation, report and continue without per-batch confirmation. Design and production-deployment boundaries remain.

Development separates by domain: customer-service/Agent owns conversation/memory/tools/project context/models/final replies; knowledge owns originals/indexing/retrieval/knowledge versions/locations/operations. Existing KnowledgeRetriever/Evidence/source revalidation connect them, with separate source/test/defect ownership and one explicit integrator for affected contract changes. Keep one product progression and authorization/job foundations; incrementally extract legacy mixed adapters without turning knowledge work into another Agent refactor. One [phase-two boundary](./xiaok-assistant-phase-2.md#agent-and-knowledge-development-ownership) is authoritative.

Proceed through professional answers → explanations using actual context → sustained handling when needed → formal handling and management service. Later placement never means rebuilding existing P5 or other foundations. Finish already-authorized batches still under acceptance against their contracts; prioritize professional answers for new work. Every batch connects Mini entry and real services, without a final deferred client-integration phase.

| Order / existing phase | Delivery and dependencies | Focused acceptance / PPT | Design groups |
| --- | --- | --- | --- |
| 1: P2M.1–.3 Professional support | Semantic enterprise retrieval, versions/conditions, natural explanations/comparisons and corrections; reuse images/controlled reads, feed knowledge/tool evidence into the same generation | Assigned QA-01/02/05/06/07/08 and XK-01/07/08 segments;5,6,10–15 | C01,C02,S01,U01 |
| 2: P3B/P4A Actual-context answers and follow-up | Read real stages/records/needs/effective drawings and explain together; reuse stable issues, owners/waiting parties, event returns and cancellable watches only when handling is needed | QA-03/04 and XK-02/03/04/07/08;16–26,35–38 | C04,S03,S04,S05, reusing C01/C02/S01/U01 |
| 3: P5/P6 Formal handling and operations | Reuse formal versions/decisions/execution results, connect remaining cross-phase handling, then produce supported digests/questions/coordination across at least two differently progressing projects | XK-05/06 plus07/08 regressions;13,15,19,20,23,25,26,33,38,39 | C05,S05,S06, reusing S04/U01 |
| As-needed support: P2B/P2C/P3A/P4B | Reuse reception, lawful portfolios/designer recommendations, actual projects and public projections; close only main-line gaps under3.2 | Source, permission, reentry and withdrawal checks;2–4,7–13,16–21,26,33,34,37,39 | C03,S02,S03,S07 and existing approved groups |
| Separate extensions: P2M.4/P4C.1–.3 | Audio uses the same Agent; devices progress through activation/delivery, authorized playback and support/exit with separate real-channel checks | Original audio/transcripts and orders/playback/revocation/refunds;5,14,22,26–34 | C06,O01,O02,O03, reusing C04/C05/U01 |

Prioritize KB-1 professional entries, diagnostics and C01 answers using existing text/FAQs; add KB-2 ingestion/KB-3 enhancements as the service line needs them, without full-format support as a prerequisite.

Deliver Agent engineering alongside these business phases under sections 1–2 of its dedicated plan: P2M first closes near-term answering foundations, P3B/P4A adds topic/issue and cross-day continuation, and P5/P6 reuses them for formal business. Each batch verifies touched permission, tool and recovery boundaries. AG-* expands engineering criteria for assigned QA/XK cases without a whole-suite prerequisite phase.

AG-01 adds query-directed older originals to rebuildable semantic extracts under `extractive-history-v2`, while retaining the existing model budget and original-speech authority. AG-02 adds `need-memory-archive-v1`, separating accumulated corrections from up to300 current room+field keys so additions/corrections can cross the old cumulative300-record boundary. Complete replaced assertions and supersedes chains are atomically retained in existing run steps; customers continue through C01 and authorized original-message recall, with withdrawal filtering extended to archives. The [current phase-two contract](./xiaok-assistant-phase-2.md) owns exact implementation, checks/failures and native limitations. Free-form process summaries, archive-scale semantic recall, multi-home/compound-field handling and model capacity with a full current projection remain follow-up work; this bounded implementation does not complete AG-01/02 or acceptance for the whole phase.

AG-04/05 adds bounded continuation for an explicit leading correction followed by a separate question: reuse atomic multi-field receipts and current-original H sources without saving hypothetical tails. Conditions/reported speech/refusal, source and recovery fences remain. Unmarked compound statements, multi-home scope and the full intent system remain open; the [phase-two same-turn contract](./xiaok-assistant-phase-2.md) owns implementation, fixed acceptance and limits without upgrading the whole phase.

Phase IDs identify capabilities, not authorization, design approval or implementation. Design groups need main frames, material variants and shared states; consult ledgers for actual approval/runtime status. Ordinary topic/copy variants reuse components without new pages, roles or approval workflows.

Current v74 delivers bounded finalization after empty history through the original four calls/one repair, private checkpoints and C01. Fixed49-unit/4-recovery/73-Mini/four-real-request evidence is in the [recovery contract](./xiaok-assistant-phase-2.md). This bounded fix does not complete professional advice, historical identity, knowledge/site-claim semantics or full PPT acceptance; continue the next batch under unified ownership.

### 3.2 Confirmed business boundaries

2026-10-20 v95 is closed out under the user's instruction to stop development; both plans and this batch remain Limited. Code adds exclusive chat-recap tool scope, a read-only current view for legacy compound/wrong-key desk corrections, deferred premature final_response handling, and a bounded server reply when its correction source is unavailable. Original memory is not backfilled; no additional Agent or knowledge pipeline. On the final889 source/test/config hashes,275 units,98 Mini and scoped/full lint pass; scoped types0/global292. Final service, compatibility and native acceptance were waiting for the shared lock and were cancelled before starting, so earlier-version passes do not qualify. In a separate earlier GLM9 window, native runs1149/1150 succeed and1151 is blocked after source loss; that whole batch fails. The latest partial reply has unit coverage but no final service/native proof. Prior v93 completion-record and v94 receipt evidence remains; F-01/F-02/F-04/F-06/F-07 and full PPT/device/production acceptance stay open. Free-text GLM9, LLM/VLM/enterprise1454 configuration, tenant/revocation boundaries, KnowledgeRetriever/Evidence and approved UI remain;1132/3196 stays unknown/reconciling with null settlement. See [phase two](./xiaok-assistant-phase-2.md), [handoff](./xiaok-assistant-handoff.zh-CN.md) and tmp/xiaok-current-needs-v95/interruption-closeout.json.

<!-- Preserve existing section links; this section and section2 references own current rules/evidence. -->
<a id="31-current-p2c-scope-and-community-search"></a>

- **P2C portfolios/communities:** initial publishing stays in independent Admin management, with designers owning their work and enterprise management reviewing. Mini customers enter original PPT2/3 designer/portfolio screens from C01 recommendations and return to the original consultation, without a new top-level directory/publishing workbench. Separate originals/authorized references, renderings/photos and actual authors/rights. Recommend effective works; same community is not the same plan, and browsing never changes ownership/commissions. Community binding is optional. Prefer AMap under platform map settings; saved keys plus explicit enablement allow queries, with optional authorization notes/dates rather than software gates. Preserve strict cities, signed selection/stable IDs, minimal binding snapshots, quotas and revocation. No national catalogue, external plan library or automatic purchases/top-ups; disclose actual provider rights/recall limits. Phase two/inventories retain details.

<a id="construction-stage-contract"></a>
<a id="construction-staff-contract"></a>

- **P3A staff/actual stages:** designers, construction staff and owners use one cloud-site page with effective member/enterprise scopes. Staff join the enterprise before assignment; identity, skills and project responsibilities stay separate from surveying/design dispatch/commissions. Management appoints managers; managers handle assigned projects and ordinary members/stage assignments only. Read contacts from currently effective staff records and revoke promptly. Managers update configurable stages from site facts, not dates/AI guesses; homeowners retain private-chat stage notices/phone actions.

<a id="34-p3b-stage-questions-and-review-in-the-original-chat-bounded-loop"></a>
<a id="35-p4a-shared-project-chat-publication-and-watches-bounded-loop"></a>

- **P3B/P4A team handling:** reuse original-chat supplements, S01 review and S04 shared originals/photos/drafts/versions under1.2–1.3. Consultation watches, issue handling and formal approval cannot substitute for one another. Event delivery rechecks project/source/audience and defers during takeover under existing contracts, without AI interruptions.

<a id="37-p4b-public-sites-exact-consent-and-review-bounded-loop"></a>

- **P4B public scope:** staff prepare lawful excerpts/independently redacted materials; enterprise review follows owner consent to an exact version. Public copies, internal chat and original consultation remain separate; visitors return only to their own consultation. Scope changes need new consent; withdrawal affects search/cache/citations/media. Offer area selection without location, publish nothing without consent, and define public video streaming separately.
- **P5 formal business:** reuse consented associations, proposal issuance/differences, exact decisions, execution evidence, formal resolution/closure and original-consultation returns under existing contracts. Ordinary answers/replies do not substitute. Guard original access and returned excerpts separately; versions, withdrawal and member changes invalidate old execution authority.
- **P4C device service:** retain configurable PPT quote/contract baselines:5 cameras,1 shared4G gateway/SIM,90 days,CNY1199 service/CNY800 refundable deposit, start after acceptance, at most2 streams≤1Mbps,no automatic renewal and contractual refunds after dispute resolution. These are not launched prices/payment authorization/SLAs. Determine provider/API,4G, recording retention/export, payment/acceptance parties, response, overrun/damage and refund channels within the relevant batch. Real orders/manual delivery may precede integration; incomplete playback/refunds remain Limited without mock completion.

## 4. Phase acceptance and completion

### 4.1 Professional customer support acceptance

QA-01–QA-08 are professional-answer target cases; old material/issue tests do not replace them. Each phase runs assigned PPT segments/necessary regressions. Later domains, broad long-tail image/language evaluation and product comparisons are not additional current-phase prerequisites.

| ID / scenario | Phase / PPT | Required answer and boundaries |
| --- | --- | --- |
| QA-01 General explanation | P2M / 5,6,14,15 | Explain principles/tradeoffs and continue context; retrieve enterprise evidence when needed and label general advice, rather than blanket need collection/refusal/escalation |
| QA-02 Enterprise practice | P2M / 5,6,19 | Natural questions trigger applicable retrieval/explanation without literal “your company”; support conditions/units/exceptions, beyond FAQ/excerpt listing |
| QA-03 Knowledge plus actual stage | P3/P4 / 16,18–20,37 | Same question across different-stage fixtures explains corresponding conditions/impacts using both enterprise evidence and the correct project snapshot; no inferred completion/schedule commitment |
| QA-04 Site-material explanation | P4A/P5 / 22,23,38 | Combine authorized originals/records, actually supplied photos and professional evidence; disclose observations/review needs, without unpublished leaks or acceptance/exact dimensions from one image |
| QA-05 Follow-up/correction | P2M→P3/P4 / 6,14,15,23 | “Why/another position?” continues established objects; corrections affect relevant facts/explanation with requery as needed. Clarify ambiguity without mixed homes/lost independent needs |
| QA-06 Gaps/conflicts/updates | P2M→P3/P4 / 5,6,18,23 | Supported partial answers/minimal review needs; revisions use effective sources, never arbitrary similarity/upload precedence or no-record-means-no-event |
| QA-07 Audiences/untrusted materials | All phases / 7–9,14,23,33 | Customers/members/visitors each use lawful evidence; source instructions cannot change permissions. Withdrawal/removal affects answers/reentry/links/derived memory |
| QA-08 Explanation versus handling | P2M→P4A/P5 / 5,10,11,23,38 | Ordinary explanations create no issues; explicit review/human requests retain context in real continuation. Reconcile unknown receipts, never invent completion or interrupt human mode |

### 4.2 Association, sustained follow-up and cross-phase acceptance

In approved development/isolated databases, continue one synthetic enterprise, homeowner, project and study: professional question → supplement/correct two-person working/appliance needs → actual electrical preparation → worker point-location issue/photos → effective drawings/needs → same-issue review/transfer/handling → exact-version decision/execution return → owner digest/question. Add another project, same-name room, nonmember and tenant counterexamples while retaining the same source/issue/version chain.

| ID / service segment | Phase / PPT | Required outcome, recovery and isolation |
| --- | --- | --- |
| XK-01 Need continuation | P2M→P3A / 5,6,13–15 | Originals/images/corrections reach the correct home with staff traceability; next-day cleared-cache reentry retains independent needs without guessed ambiguity |
| XK-02 Stage questions | P3B / 16,19,35,37 | Reuse known needs at the actual stage, ask critical gaps only, avoid asked/deferred repetition; rescheduling/source changes invalidate old reminders |
| XK-03 Find site materials | P4A→P5 / 22,23,33 | Evidence for same-project/room effective drawings/needs/originals; clarify/fix gaps/wrong links, without query-created progress drafts or stale/unauthorized materials |
| XK-04 Sustain one issue | P4A→P5 / 17,20,24,36,38 | Same issueId across days/stages/restarts for review, transfer, reply and return. Real owner/waiting party, no duplicate assignment/delivery, evidence-bound closure |
| XK-05 Formal change | P5 / 19,23,38 | Differences/cost/schedule and necessary exact-version decisions; decline/defer leaves chat usable, V3 consent never covers V4, stale drawings/revocation stop execution, submission/approval/execution remain distinct |
| XK-06 Digest/questions | P6 / 20,25,26 | At least two distinct real project states with “waiting for whom/why” drill-down. Refresh after handling; distinguish missing data/no deadline/overdue/abnormalities, excluding unauthorized private chats |
| XK-07 Audiences/withdrawal | P2M/P4A/P4B/P5/P6 / 7–9,23–25,33 | Cover same-enterprise other projects, other tenants, disable/removal/revocation/public replacement. History/media/caches/derived answers/digests cannot bypass sources |
| XK-08 Failure/takeover recovery | All phases / 5,10,11,22,24,38 | Model/tool failure, closed pages, lost receipts, duplicates/disorder and Worker restart preserve originals and one business effect; restore correct modes/valid work after takeover/cancellation |

### 4.3 PPT visual baseline and automated acceptance after every restoration

<a id="36-previous-plan-and-ui-audit-corrections"></a>

**Every Mini UI restoration, material variant or visible-state adjustment requires automated fidelity checks after development, with separate functional/visual acceptance.** Use2.2's PPT, each route's one latest approved ledger source and restored UI. Map original853×1844 standalone screens by width to390×844; differently sized approved standalone sources retain their actual aspect ratios without stretching. Boards are overviews only; original PPT22/38 remains S04's main source, not rejected intermediate designs.

Regenerate missing designs from corresponding/adjacent PPT canvas, hierarchy, green/white palette/soft backgrounds, weights/wrapping, bubble/card proportions, icons and XiaoK illustration language. Record source pages/component mappings; green/XiaoK alone is insufficient. Obtain explicit approval before implementation/source replacement. Ordinary states reuse approved components/specifications without individual images/approvals. Independently generate business illustrations as transparent PNGs under project rules,≤300KB packaged, no WebP or full-screen slicing/cropping into product UI.

| Check | Automation and same-scale design comparison |
| --- | --- |
| Canvas/containers/safety |390×844 baseline navigation/content/bottom/key actions; verify native WeChat capsule and preserve application-layer plus full host-window captures |
| Typography/wrapping | Compare visible glyphs, sizes, weights, line heights/counts; minimum sizes alone are insufficient, and long text wraps using real content |
| Spacing/tall layout | Compare adjacent/group distances, alignment/card proportions and at least one tall viewport. Fixed content uses intrinsic sizing without height-driven group gaps; dynamic content may scroll |
| Icons/illustrations/treatment | Compare strokes, alpha bounds/optical sizes, photos, corners/backgrounds/palette using corresponding approved/generated assets rather than generic substitutes |
| Affected states | Use real data for batch main/material/affected sending/retry, long text, keyboard, scrolling/reentry states with accessible inputs/actions; no edited-to-fit copy or empty-only substitutes |

1. Follow standing-authorized stable WeChat DevTools automation and AGENTS.md window/recompile discipline on real routes/interactions. Recompile after taking control/reopening; recover freezes through documented recompile/reconnect/retry without new routine approval.
2. **Before every screenshot, verify the top runtime route exactly matches the target**, then confirm real data/rendering and viewport. Home/launch frames/browser specimens do not prove another route's native fidelity. Extract measurable bounds/positions/sizes; record design/actual/delta values and assertions in existing route design/restoration records, with native image review for typography/optical proportions.
3. Record differences, fix and rerun with the same data/viewport until material in-scope deviations are resolved. Overlays/difference images are optional diagnostics without mandatory HTML prototypes/universal pixel scores. Compilation, routes/element presence, no overlap or saved screenshots alone cannot pass.
4. Existing phase contracts, bilingual inventories and restoration ledgers record PPT/approved sources, actual route/state/viewport, fixtures/commands, capture/element evidence and correction/rerun conclusions. Keep one current source/status per route; temporary evidence stays in tmp/ or design-references/. Unexecuted checks, unavailable automation after recovery or unresolved material differences remain pending/failed, never completed restoration or mandatory user hand-tests/screenshots.

### 4.4 Evidence, phase completion and progression

- **Data/real service chain:** when needed, create clearly labelled synthetic enterprises/users/projects/records/media only in approved development/isolated databases, with separate fixture IDs/repeatable commands and no production seeding. Mini entry plus real HTTP/Worker/database readback verifies writes, feedback, cross-role access, recovery and reentry. Tool fixtures/single model responses do not establish the service chain.
- **Professional-answer criteria:** predefine professional points, necessary effective enterprise/project sources, allowed general advice and forbidden inferences for fixed QA cases without verbatim matching. Verify actual answers, correct conditions/tradeoffs, supported conclusions and facts/unknowns; project questions require evidence and the correct snapshot together. Separate structural/semantic/service evidence; model self-grading is never the sole basis.
- **Real model/recovery:** run phase core cases for added semantic capabilities at least twice on the configured model/prompt, preserving per-turn tools/sources/results. Record completion, unsupported answers, repetition/clarification, first/full-response latency and verifiable usage/costs, leaving unknown costs unknown. Engineering checks do not grade prose; historical80-case baselines need not be rebuilt each batch. Extra wording/long-tail/human reviews are follow-up improvements.
- **Scoped completion:** assigned PPT/QA/XK segments, touched AG work-package criteria, necessary dependency regressions and applicable4.3 visual acceptance pass, with no test-set cross-tenant/unauthorized reads/effects, duplicate writes, fabricated commitments or stale-version execution. Correct refusal/gap disclosure passes its negative case, not the normal chain; bounded passes do not upgrade entire phases/PPT.
- **Documentation/evidence:** implementation updates phase contracts, bilingual inventories and affected restoration ledgers with actual commands, role/project/room, data/source/issueId/revision, model/policy, results and uncovered checks. Record implementation, functional/visual acceptance and production approval separately. Do not duplicate execution logs back into this roadmap or mark unexecuted QA/XK/visual targets passed.
- **Progression/boundaries:** while explicit development authorization is active and no user pause applies, continue the next authorized phase after these checks/docs without user screenshots/human A10/confirmation replies. Simulator limits for devices/BLE/real WeChat/external channels stay unverified/non-blocking, without fabricated acceptance or completed untested visuals. New/conflicting designs need explicit approval; actual paid services/data transfer/production retain existing authorization boundaries.
