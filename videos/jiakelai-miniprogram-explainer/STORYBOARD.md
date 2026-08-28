---
format: 1080x1920
duration: 74s
message: "家客来小程序把装修获客、量房、方案、交付收在同一条协作链上，五种身份各做自己的事"
arc: "Promise → Role tour → Lockup"
audience: 内部讲解、渠道介绍、给装修公司老板看的产品说明
mode: collaborative
music: calm confident home-design underscore, light piano and soft pulse, never cinematic trailer
captions: no
---

## Video direction

Palette from `frame.md`: canvas `#FFFFFF`, ink `#1F2937`, sole accent `#00c365`, mint tints `accent-light` / `card-bg`, muted grey for helper labels. Role chips use `tag-pill`. Never invent a second accent. Type by role: display for role/headline, body for plate labels.

Motion grammar: long-tail `power3` eases. VO-paced reveal — at t=0 only the current spoken cue is on; later pieces enter when named. Holds use subtle jitter only (`sine-wave-loop` low). Role frames share one grammar: phone plate already in the confirmed sketch; the real design draft fills that plate; `coordinate-target-zoom` pushes to the named region; a side/top headline swaps via `discrete-text-sequence`. Camera otherwise static (`multi-phase-camera` micro-drift only).

Rhythm: Frames 2–5 are working tours (continuous region reveals). Frame 1 is kinetic type over a dim login plate. Frame 6 holds the lockup line after the last VO cue — the only true breather.

Never: nav/browser chrome around the design draft (the draft already includes WeChat capsule), sliced composite screenshots, reading amounts off the referrer mock, old job titles, front-load-then-freeze, screensaver drift, or a karaoke caption track. Fill the 1080×1920 canvas; do not reserve a dead bottom band.

## Frame 1 — 这条链

- scene: 访客入口满屏，叠加「获客 / 量房 / 方案 / 交付」四个词依次落下，落成「家客来」
- voiceover: "装修要的，不是又一个工具。是获客、量房、方案、交付——跟在同一套房上。家客来小程序，就是这条协作链。"
- duration: 14.256s
- poster: 6s
- transition_in: cut
- status: animated
- src: compositions/frames/01-chain.html
- type: hook
- persuasion: Category announcement + future pacing
- beat: curiosity → clarity
- blueprint: compose
- focal: assets/guest-login.png
- roles: guest-login.png = background (dim ~40%) · brand-logo.png = cutout
- sfx: whoosh
- asset_candidates: assets/guest-login.png — JoveKore｜家客来访客入口，小K走进绿色门厅；assets/brand-logo.png — JK 房屋标

narrativeRole: 先讲产品是干什么的——把散落工具收成一条跟房走的协作链。
keyMessage: 家客来不是又一个工具，是获客到交付的同一条链。

Adapt: keep the in-place word-swap signature; change the void canvas to the confirmed sketch — dim guest-login plate behind type, then four chips assemble and the logo lockup lands.

Scene 1 (0.0–3.5s): guest-login plate seats in the confirmed phone block, dim ~40%; display line 「不是又一个工具」 hard-cut flash-in at upper third — Centered type over dim plate. → `discrete-text-sequence`
Scene 2 (3.5–9.8s): the line holds; only the token slot cycles 获客 → 量房 → 方案 → 交付 as each is named (hard-cut, no fade) while the four chips stagger into the confirmed chip row — Centered type, chips as supporting strip. → `discrete-text-sequence` + `spring-pop-entrance`
Scene 3 (9.8–14.256s): chips hold; brand-logo + 「家客来」 spring-pop as the lockup; guest-login stays dim behind; subtle jitter only. Held read. → `spring-pop-entrance` + `sine-wave-loop`

## Frame 2 — 客户 · 服务向导

- scene: 客户服务首屏满幅，缓慢推向三项免费权益与服务票据
- voiceover: "业主打开服务页。三项免费：效果图、设计顾问、现场顾问。进度在一张票上。下一步，只有一个按钮。"
- duration: 14.088s
- poster: 7s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-customer.html
- type: feature_showcase
- persuasion: Show-don't-tell proof + value stacking
- beat: ease + peace of mind
- blueprint: compose
- focal: assets/customer-service-home.png
- roles: customer-service-home.png = cutout
- sfx: whoosh
- asset_candidates: assets/customer-service-home.png — 客户三项免费权益服务首页

narrativeRole: 第一条证据——客户看见自己的服务，而不是公司内部工具。
keyMessage: 客户只面对三项免费和当前下一步。

Adapt: keep surface-as-hero + region cycling; drop floating landscape phone void — fill the confirmed portrait plate full-bleed with the real draft; zoom-to-target the named regions. Signature: establish then operate the surface.

Scene 1 (0.0–2.4s): role chip 「客户 · 服务向导」 already in sketch; customer-service-home fills the phone plate (edge slide-in + settle), first view is the green 三项免费权益 hero — portrait plate ~70% of top-83%. → `spring-pop-entrance`
Scene 2 (2.4–8.2s): as VO names 效果图 / 设计顾问 / 现场顾问, zoom-to-target each of the three benefit rows in turn (keyword glow on the named card) — camera otherwise static. → `coordinate-target-zoom` + `asr-keyword-glow`
Scene 3 (8.2–11.0s): zoom-to-target the white 服务票据 / 四步进度 as 「进度在一张票上」. → `coordinate-target-zoom`
Scene 4 (11.0–14.088s): land on 「预约上门」 primary button; press-release pulse once; hold. → `press-release-spring` + `sine-wave-loop`

## Frame 3 — 推荐人 · 推广管家

- scene: 推广工作台满幅，推向出示服务码主按钮
- voiceover: "推荐人出示服务码。客户一扫，档案就建好。进度脱敏可见。收益，只记在本人名下。"
- duration: 12.048s
- poster: 7s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/03-referrer.html
- type: feature_showcase
- persuasion: Friction reduction + Feature-to-benefit translation
- beat: control + trust
- blueprint: compose
- focal: assets/referrer-workbench.jpg
- roles: referrer-workbench.jpg = cutout
- sfx: ui-tap
- asset_candidates: assets/referrer-workbench.jpg — 推荐人推广工作台

narrativeRole: 获客入口——推荐人只出示码，不碰客户隐私。
keyMessage: 扫码建档，进度脱敏，收益记在本人。

Adapt: same portrait-plate tour; do not glow or read any 金额 on the mock.

Scene 1 (0.0–2.7s): role chip 「推荐人 · 推广管家」; referrer-workbench fills the plate and settles on the green Hero / 出示推广服务码 — portrait plate. → `spring-pop-entrance`
Scene 2 (2.7–6.0s): zoom-to-target the 出示推广服务码 CTA as 「出示服务码 / 一扫」; one press-release on the button. → `coordinate-target-zoom` + `press-release-spring`
Scene 3 (6.0–8.5s): zoom-to-target 服务进度 card as 「进度脱敏可见」. → `coordinate-target-zoom`
Scene 4 (8.5–12.048s): zoom-to-target 我的收益 card as 「只记在本人名下」; hold, no currency callout. → `coordinate-target-zoom` + `sine-wave-loop`

## Frame 4 — 家装设计顾问

- scene: 设计顾问工作台满幅，推向待交付方案卡（户型 + 效果图）
- voiceover: "家装设计顾问跟进自己的客户。户型一到，用风格配方出图，点一下发给客户。"
- duration: 9.912s
- poster: 8s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-designer.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation + Show-don't-tell proof
- beat: competence + ease
- blueprint: compose
- focal: assets/designer-workbench.jpg
- roles: designer-workbench.jpg = cutout
- sfx: ui-tap
- asset_candidates: assets/designer-workbench.jpg — 家装设计顾问工作台大盘

narrativeRole: 方案怎么交出去——自己的客户、量房资料、配方出图、发给客户。
keyMessage: 设计顾问把户型变成客户看得见的方案。

Adapt: portrait-plate tour; headline copy uses 家装设计顾问, never 设计师端.

Scene 1 (0.0–3.2s): role chip 「家装设计顾问」; designer-workbench fills the plate on the collaboration hero — portrait plate. → `spring-pop-entrance`
Scene 2 (3.2–5.4s): zoom-to-target 客户线索 as 「跟进自己的客户」. → `coordinate-target-zoom`
Scene 3 (5.4–7.8s): zoom-to-target 风格配方 then the 待交付方案 pair (户型 + 效果图) as 「户型一到，用风格配方出图」. → `coordinate-target-zoom`
Scene 4 (7.8–9.912s): zoom-to-target 「主动发布给客户」; press-release once; hold. → `press-release-spring` + `sine-wave-loop`

## Frame 5 — 家装现场顾问

- scene: 现场顾问工作台满幅，推向激光测距连接与今日待量
- voiceover: "家装现场顾问连上激光测距仪。按今日任务上门量房，毫米级户型交回设计。"
- duration: 9.984s
- poster: 8s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-measurer.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: competence + control
- blueprint: compose
- focal: assets/measurer-workbench.jpg
- roles: measurer-workbench.jpg = cutout
- sfx: whoosh
- asset_candidates: assets/measurer-workbench.jpg — 家装现场顾问工作台

narrativeRole: 量房怎么进链——连仪器、按任务上门、户型交回设计，不从空白编辑器进。
keyMessage: 现场顾问按任务量房，户型直接交给设计。

Adapt: portrait-plate tour; VO and labels say 连接测距仪 / 从任务进入, ignore the mock's 「进入量房编辑器」 hero CTA.

Scene 1 (0.0–3.4s): role chip 「家装现场顾问」; measurer-workbench fills the plate on the scheduling hero — portrait plate. → `spring-pop-entrance`
Scene 2 (3.4–6.2s): zoom-to-target the 蓝牙测距仪 connected pill as 「连上激光测距仪」; keyword glow. → `coordinate-target-zoom` + `asr-keyword-glow`
Scene 3 (6.2–8.4s): zoom-to-target 今日待量 / 今日待上门任务 as 「按今日任务上门量房」. → `coordinate-target-zoom`
Scene 4 (8.4–9.984s): hold the task list as the proof of 毫米级户型交回设计; subtle jitter, no editor chrome. → `sine-wave-loop`

## Frame 6 — 企业负责人 · 收束

- scene: 经营首页满幅，推向分享活动码 / 邀请入驻，收在品牌锁
- voiceover: "企业负责人看全店。分享活动码获客，邀请伙伴入驻，异常优先处理。一条链，五种身份，各做各的事。"
- duration: 13.488s
- poster: 8s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-owner.html
- type: cta
- persuasion: Rule of three + Status seeking
- beat: confidence + motivation
- blueprint: compose
- focal: assets/enterprise-owner-home.png
- roles: enterprise-owner-home.png = cutout · brand-logo.png = supporting
- sfx: impact-soft
- asset_candidates: assets/enterprise-owner-home.png — 企业负责人经营首页；assets/brand-logo.png — 收束锁

narrativeRole: 老板看见全店调度，并把五种身份收回「一条链」这句话。
keyMessage: 负责人调度全店；五种身份各做各的事。

Adapt: keep surface tour then resolve to lockup (kinetic-type coda on the confirmed lockup line). Signature: operate the surface, then hold the closing line.

Scene 1 (0.0–2.6s): role chip 「企业负责人 · 经营端」; enterprise-owner-home fills the plate on 待派单/待量房/待交付 capsules — portrait plate. → `spring-pop-entrance`
Scene 2 (2.6–7.0s): zoom-to-target 分享活动码 then 邀请入驻 as each is named. → `coordinate-target-zoom`
Scene 3 (7.0–9.2s): zoom-to-target 需优先处理事项 as 「异常优先处理」. → `coordinate-target-zoom`
Scene 4 (9.2–13.488s): plate eases back; brand-logo + lockup 「一条链，五种身份，各做各的事」 spring-pops into the confirmed lockup slot; hold still (breather). → `spring-pop-entrance`
