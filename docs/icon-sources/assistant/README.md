# XiaoK consultation assets

<!-- site-capture-icons -->
- V3 capture and 05 review use the official OpenAI Images API `gpt-image-2.5-flare` through `openai-api-image`. In [site-daily-fidelity](../../../design-references/cloud-site-redesign-20261107/assets/site-daily-fidelity/), `glyphs-v001.png` supplies six separate 96×96 transparent PNGs in `miniprogram/packages/construction/assets/notebook/`: `capture-camera.png`, `capture-mic.png`, `capture-v3-members.png`, `capture-received.png`, `capture-upload.png`, and `review-clock.png`. Camera and microphone use 26px image boxes, the member glyph uses 19px and status glyphs use 16px. The manifest records the individual alpha bounds, source boxes, hashes and packaged sizes.
- The 05 review mascot maps `xiaok-review-v001.png` to `capture-v3-xiaok.png` (168×168, 4,414 B, transparent), displayed in a 54px box. The V3 paper surface maps `warm-paper-v001.png` to `capture-v3-paper.png` (360×778, 170,577 B, opaque). Three successful API responses report 7,948 input and 1,158 output tokens. Prompts, request receipts and [asset mapping](../../../design-references/cloud-site-redesign-20261107/assets/site-daily-fidelity/packaged-assets.json) are stored beside the independent sources.
- The original quick-selection check, file and chevron use the locally packaged Lucide/ISC family. `notebook-font.less` embeds the Noto Serif SC Black subset under the [OFL license](../../../miniprogram/packages/assistant/assets/StudioSerif-OFL.txt).
<!-- /site-capture-icons -->

- Approved01 conversation list (2026-11-02): existing independent Lucide/ISC MessageCircleMore geometry from notebook-tab-chat.svg, deep-green stroke #073c30, 48x48 transparent PNG1283B at miniprogram/packages/assistant/assets/conversation-outline.png. Source conversation-outline.svg stays here; no composite UI pixels, AI generation or new business illustration. House remains requirement-home.png; plus, arrow and binding rings are native geometry.

- Work detail v5 (2026-10-30): user-selected `openai-api-image`, official OpenAI Images API, four independent `gpt-image-2.5-flare` requests (no retry/fallback;5939 total tokens recorded). Source `design-references/designer-portfolio-publishing-v1/redesign-proposal/work-detail-v1/implementation-assets-v5/work-v5-{oak,linen,microcement,sage}-source.png` → `miniprogram/packages/assistant/assets/work-v5-material-{oak,linen,microcement}.png` (160×160,33,615/39,877/32,451B) and `work-v5-sage.png` (160×240,21,326B,true alpha). Exact hashes/request IDs/usage and package mapping in the adjacent `packaged-assets.json`. Textures illustrate only explicitly named materials, not products or real room photos. Existing standalone Lucide Box/arrow remain licensed; light-paper icon colour is native styling, outward/share marks are native lines measured from v5. The full existing Noto Serif SC Black/OFL3500-common-Han face is shared via explicitly included `assets/studio-serif.woff2.br` and global `lib/studio-font.js`; the identical696,256-byte WOFF2 is restored with readCompressedFile/br before Data URL loading (raw SHA-25679b60b72…, font-package01), while the old `assets/studio-serif-data.js` stays local and is excluded by packOptions, retaining every glyph/advance and the existing `StudioSerif-OFL.txt`. No source screenshot slicing/WebP or remote font request. 官方API独立生成、无复合UI裁切；字体完整字形保持，详情与首页只加载一次。

- Notebook chat (2026-10-30): current source `design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/README.md`. Built-in ImageGen independently generated `assets/chat-notebook-mascot.png` (360×329,12,939bytes) and `assets/chat-notebook-sage.png` (160×240,8,619bytes), copied to `miniprogram/packages/assistant/assets/` with true alpha, no WebP/slicing. Original prompts and PNG mapping are in that design directory. Lucide/ISC MessageCircleMore,House,UserRound,ArrowUpRight,CornerDownRight supply `notebook-tab-*`, `chat-arrow-up-right`, `chat-corner-arrow`; independent SVGs are kept here. Fixed headings use a Noto Serif SC Black/OFL subset in `chat/chat-serif.less`, license `assistant/assets/StudioSerif-OFL.txt`. Other pictograms reuse the existing licensed set. Seven supplementary full-screen images are design references only; live photos are authenticated service media. 手账欢迎素材为独立生图，纸层与卡片原生构建；补稿不切片打包，工地／作品摄影不成为运行包静态图片。

- Portfolio notebook template (2026-10-29): built-in ImageGen independently recreated the botanical sage sprig using the approved B long page only as a style reference. `design-references/designer-portfolio-publishing-v1/redesign-proposal/notebook-sage-cutout.png` → `miniprogram/packages/assistant/assets/notebook-sage.png`,160×240,true alpha PNG,4,356bytes. The paper/spine/torn edge are native geometry; no composite source pixels enter the package. Existing licensed Lucide `requirement-home/style/budget.png` and Studio Serif/OFL remain. 手账B模板的独立叶片非设计图裁切；话题图标和字体沿原许可，无WebP或新图标体系。

- Designer studio dock (2026-10-29): reuses the existing licensed `studio-arrow-right.png`/`studio-arrow-right.svg` pair at a20×24px box (visible alpha about18.3×10px), and the existing independent `designer-studio-assistant.png` at28×32px. No new asset, CSS multi-stroke icon or source-image slice. 底栏沿同套Lucide箭头与独立小K，实际框与可见范围见当前作品集设计README及原生台账。

- Designer studio long page v2 (approved for implementation 2026-10-27): Lucide `Funnel`, `X`, `Check`, and `MoveRight`, using the same installed Lucide/ISC license below, are rendered independently at 96×96, stroke1.7 into `miniprogram/packages/assistant/assets/{studio-filter,studio-close,studio-check,studio-arrow-right}.png`. Their editable SVG sources are adjacent `{studio-filter,studio-close,studio-check,studio-arrow-right}.svg`; the route uses 30/34/22/38×48rpx boxes, calibrated to visible alpha bounds: close about9.9×9.9px and arrow17.4×10px at390×844 (the transparent canvas is larger). Existing independent XiaoK, font, location and tour assets are reused. No composite screenshot pixels, remote icons, WebP or new business illustration. 长页筛选、关闭、勾选和查看箭头沿用同套Lucide许可；源SVG与独立透明PNG一一对应。

- Designer studio A (approved 2026-10-26): a new independent built-in ImageGen full-body XiaoK cutout, source `design-references/designer-portfolio-publishing-v1/redesign-proposal/studio-assistant-cutout.png` and adjacent `studio-assistant-cutout-prompt.txt`, is optimized to `miniprogram/packages/assistant/assets/designer-studio-assistant.png` (136×131 alpha PNG,15,026bytes). It is a standalone role illustration, never a slice of the approved composite UI. `studio-location.png` (72×72 alpha PNG,2,008bytes) renders Lucide `MapPin` with stroke1.65/#49635a under the existing ISC/Feather MIT licenses below. Existing share/arrow/tour icons remain unchanged. A版小K为独立新生透明素材；定位图标沿用同一Lucide许可，未将设计稿或竞品截图切片打包。

- P4B C03 uses a newly generated standalone XiaoK/map PNG, not PPT screenshot pixels: `design-references/xiaok-p4b-public-sites-v1/xiaok-public-sites-source.png` → `miniprogram/packages/construction/assets/xiaok-public-sites.png` (420×282,36,161bytes,true transparency). Built-in ImageGen,optimized palette192;the approved batch README records the full prompt/source/measurement mapping. Existing construction subpackage ArrowUp/Image/Microphone Lucide icons and the standalone main-package brand logo are reused with their original licenses;no new icon family or cross-subpackage asset dependency. C05 reuses the approved assistant avatar and composer icons.

- P4A S04: existing independent Lucide/ISC `ArrowLeft/ArrowUp/Image/Mic/UserRound` PNGs are copied to `miniprogram/packages/construction/assets/{arrow-left,arrow-up,image,microphone,person}.png`. The record glyph uses the same Lucide/ISC FileText rendered in #00B985 to `file-text.png` (96×96 alpha PNG,944bytes;50rpx box,37.5×45.8rpx alpha≥64 bounds),matching the PPT document metaphor. No new icon family or screenshot cut. Independent built-in ImageGen character: `design-references/xiaok-s04-site-records-v1/xiaok-site-assistant-source.png` → `miniprogram/packages/construction/assets/xiaok-site-assistant.png`,256×256 alpha PNG,37,896bytes. Source/prompt/optical measurements: S04 README and roadmap3.5.

Routes: `packages/assistant/chat/chat`, `packages/assistant/requirements/requirements`, `packages/assistant/handoff/handoff`, `packages/assistant/designer/designer`, `packages/assistant/work/work`, `packages/assistant/tour-view/tour-view`, `packages/construction/projects/projects`.

- Existing-UI audit: current C01/C02 and S01 standalone screens remain authoritative; original PPT5 is their historical source, not an override. Project overview retains original PPT26 `design-references/construction-workflow/cloud-site/manager.png`. Its soft background byte-reuses the independently generated `design-references/xiaok-assistant-phase1-ppt-v1/generated/xiaok-chat-room.png` → `miniprogram/packages/construction/assets/xiaok-project-scene.png`, transparent PNG780×380/51,118bytes. The duplicate stays inside its own subpackage to avoid cross-subpackage resource loads. No new generation, screenshot slicing or sample project-photo packaging. Native visual acceptance remains pending; current measurements are in phase two/roadmap3.6.

- P2C.2 studio source: `design-references/designer-portfolio-publishing-v1/ppt-sources/slide02-01.png` (853×1844). Built-in imagegen recreated the XiaoK + open spatial-material book as independent transparent artwork; optimized retained source `design-references/designer-portfolio-publishing-v1/generated-assets/designer-studio-book.png` → `miniprogram/packages/assistant/assets/designer-studio-book.png`, 1050×553 alpha PNG/140,866bytes. No UI text, controls, composite screenshot slices or invented designer portrait. Current element targets and pending native QA are in the bilingual phase-two contract/restoration ledger.
- P2C.2 `Share`: same Lucide1.8.0 ISC license below, independently rendered at stroke2/color#153d35 → `studio-share.png`,96×96 alpha PNG/779bytes,30rpx UI box. The studio also reuses House/Armchair/JapaneseYen `requirement-home/style/budget.png` at42rpx, without mixing icon families. Generator: `tmp/xiaok-vector/portfolio-icon.cjs`. All assets≤300KB, no WebP. Customer work images are authenticated server-published JPEGs, never copied into the package.

- P2C.3 3D and fallback icons: same Lucide1.8.0 ISC license below, independently rendered with sharp to standalone PNGs in `miniprogram/packages/assistant/assets/` — `tour-3d.png` (Box, white, stroke2, 96×96,1,577bytes) for the work cover 3D corner badge, `tour-3d-ink.png` (Box, #153d35, stroke2, 96×96,1,631bytes) for light cards and the tour entry, `tour-play.png` (Play, white, filled, 64×64,613bytes) for the selected 3D thumbnail, and `copy-link.png` (Copy, white, stroke2, 96×96,872bytes) for the D-03b copy-link action. No screenshot slicing, no new icon family, no remote icon URL, no WebP; each file is below300KB. Tour imagery itself stays a third-party `web-view`/authenticated JPEG and is never packaged.

- P2S current chat/handoff source: `design-references/xiaok-assistant-chat-first-batch1-v1/single-screen/C01-01.png` and `S01-01.png`, with the key variants/shared state rules in that directory's parent README. The independently generated consultation hero/avatar/scenery and staff-handoff artwork below retain their original business metaphor; no composite-source pixels are extracted.
- P2S `Mic`/`UserRound`: same Lucide1.8.0 ISC license, independently rendered stroke2/#183d30 to `miniprogram/packages/assistant/assets/microphone.png` and `person.png`. Optimized transparent PNG96×96,1,685/1,839bytes. Generator: `tmp/xiaok-vector/chat-first-icons.cjs`. Microphone is explicitly unavailable pending ASR; the generic person glyph never impersonates a real staff photo. Both assets are below300KB and are not WebP.

- P2A.2 image action: Lucide1.8.0 `Image`, ISC license below, rendered independently with stroke2/color#183d30 to `miniprogram/packages/assistant/assets/image.png` (96×96 transparent PNG,1,089bytes). PPT slide5/14 image entry;48rpx image in72×84rpx touch area. Generator: `tmp/xiaok-vector/media-icon.cjs`. No screenshot slicing or new business illustration.

- PPT slide5 progress: same Lucide/ISC `Check` and `Ellipsis`, independently rendered on green/gray circles to `miniprogram/packages/assistant/assets/guidance-recorded.png` and `guidance-pending.png`.96×96 PNG,1,626/1,628bytes; displayed at30rpx. No screenshot pixels. Generator: `tmp/xiaok-vector/guidance-icons.cjs`.

- Requirements source: `design-references/xiaok-assistant-phase1-ppt-v1/sources/slide06-needs.png`. Independent built-in ImageGen artwork `design-references/xiaok-assistant-phase1-ppt-v1/generated/xiaok-requirements.png` → `miniprogram/packages/assistant/assets/xiaok-requirements.png`, transparent PNG480×459/40,817bytes. Reuses independent scenery/logo below; no screenshot slices.
- Requirements icons: same local Lucide/ISC license, stroke2/color#153d35,96×96 transparent PNG. House, UsersRound, Armchair, JapaneseYen, CalendarDays, Pencil map to `requirement-home.png`, `requirement-household.png`, `requirement-style.png`, `requirement-budget.png`, `requirement-time.png`, `requirement-edit.png` in assistant assets. Each below300KB.

- Original P1 UI reference: `design-references/xiaok-assistant-phase1-ppt-v1/sources/slide05-consultation.png` (PPT5), superseded for current chat/handoff by the approved C01/C02/S01 screens above. Slide14 remains only a character/material reference.
- Independent built-in ImageGen illustration: `design-references/xiaok-assistant-phase1-ppt-v1/generated/xiaok-consultation.png` → `miniprogram/packages/assistant/assets/xiaok-consultation.png`. Complete stepped-house XiaoK with upright blank notebook matching the slide5 pose; transparent RGBA PNG480×440,117,813bytes. The reference UI was never sliced. It remains the hero only; assistant messages use the separate full-body avatar below.
- Independent built-in ImageGen avatar: `design-references/xiaok-assistant-phase1-ppt-v1/generated/xiaok-chat-avatar.png` → `miniprogram/packages/assistant/assets/xiaok-chat-avatar.png`, transparent PNG256×256/49,659bytes, alpha bounds x27–236/y11–253. Reference order: slide5, slide14, existing hero. Full character with no notebook, circle, text or background.
- Independent built-in ImageGen scenery: `design-references/xiaok-assistant-phase1-ppt-v1/generated/xiaok-chat-room.png` → `miniprogram/packages/assistant/assets/xiaok-chat-room.png`, transparent PNG780×380/51,118bytes. Reference order: slide5 then slide14; warm wall/window light, pale wood and a right-edge plant, with soft transparent edges and no UI/character/text. These are separate generated artworks, not screenshot slices.
- Action icons: locally installed `lucide-react`1.8.0, rendered to96×96 transparent PNG. `ArrowLeft`, `ArrowUp`, `History`, `Plus`, `X`, `BookOpen` map to `arrow-left.png`, `arrow-up.png`, `history.png`, `plus.png`, `x.png`, `book-open.png` in the same runtime directory. Stroke2; send arrow3. All packaged artwork/icons are PNG and below300KB. No runtime dependency on React/Lucide or remote icon URLs.
- Existing brand logo stays at `miniprogram/images/home-ip-v1/brand-logo.png`.
- Source-calibrated element dimensions and manual visual-QA status are in the bilingual phase-one contract and restoration ledgers.

- Notebook approved plan v002 uses the installed Lucide Map outline with a tighter viewBox and the notebook ink color. `receipt-plan-map.svg` renders to `miniprogram/packages/assistant/assets/receipt-plan-map.png` (64×64, 487 bytes, alpha). The check and outgoing arrow reuse packaged icons. The paper, fabric and tape are native styling, and the closure photo comes from the authenticated site record.

## Lucide1.8.0 license

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

<!-- portfolio-acquisition-contact -->
- Approved `design-references/designer-portfolio-publishing-v1/redesign-proposal/acquisition-flow-v1/review.html` contact icons use the standalone WeChat and phone vectors in `home-fusion-v002/contacts.js` within that review directory. `portfolio-contact-wechat.svg` and `portfolio-contact-phone.svg` render to `miniprogram/packages/assistant/assets/portfolio-contact-{wechat,phone}.png` (72×72 transparent PNGs, 2118 and 1757 bytes). The contact hint reuses the approved independent `notebook-sage.png` already packaged for the notebook template.
- The approved acquisition review's portrait slots use `miniprogram/packages/assistant/assets/designer-avatar-{male,female,neutral}.png` and identical Admin previews at `admin/public/portfolio-avatars/{male,female,neutral}.png`. The male portrait is an independent OpenAI Images API asset generated to match the approved gallery's standalone `miniprogram/images/mine-v6/profile-avatar.jpg` reference. The female portrait reuses that source, and the neutral icon reuses the assistant's `person.png` on the existing sage fill. All three are transparent square PNGs, 224/178/160px and 25641/16730/3873 bytes. The prompts, request ID, usage and asset hashes are in `design-references/designer-portfolio-publishing-v1/redesign-proposal/acquisition-flow-v1/avatar-assets/designer-male-v001.json`.
<!-- /portfolio-acquisition-contact -->

<!-- cloud-site-notebook-assets -->
- Cloud-site notebook (approved2026-11-07): official OpenAI Images API independently generated three alpha cutouts from approved01/05/06 plus the F1 source, never from screenshot slices. `design-references/cloud-site-redesign-20261107/assets/{projects,chat,public}-v001.png` → `miniprogram/packages/construction/assets/notebook/xiaok-{projects,chat,public}.png`,249×320/11103bytes,253×320/8257bytes,268×320/11340bytes. Prompts, request IDs, usage and source/package hashes are adjacent in the source/manifest. 本轮三张业务插画分别承担工地索引、记录核对、公开相册角色；只裁透明边缘，全部真实alpha且低于300KB，无复合图切片。
- The same installed Lucide/ISC family renders19 independent96×96 icons in `packages/construction/assets/notebook/`; seven are also served from `admin/public/construction-camera/assets/`. Editable SVG sources and generator `design-references/cloud-site-redesign-20261107/prepare-runtime-assets.cjs` are retained. No emoji, Unicode picture substitutes, remote icons or new family. `Site Serif` is a locally subsetted Noto Serif SC Black from the existing [OFL source](../../../design-references/designer-portfolio-publishing-v1/redesign-proposal/font-source/OFL.txt), embedded in `packages/construction/notebook-font.less` and served as `construction-camera/assets/site-serif.woff2` for H5; dynamic missing characters retain system serif fallback. 图标/字体沿原许可，UI纸页、布签、书脊和操作均为代码组件，角色以外不打包AI页面图。
<!-- /cloud-site-notebook-assets -->
