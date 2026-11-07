# XiaoK consultation assets

<!-- site-capture-icons -->
- Approved capture V3 reuses the existing Lucide/ISC family: Camera, Mic, CircleCheck, CloudUpload and Check render to `miniprogram/packages/construction/assets/notebook/capture-{camera,mic,received,upload,check}.png`. Each is a standalone 72×72 transparent icon, respectively 1144/1206/1604/1530/319 bytes, below 300KB. The existing independently generated `xiaok-chat.png` remains the only business illustration. No reference screenshot slices or new generated artwork. Camera/Mic white strokes, received green and upload brown map to V3 controls/statuses; the glyphs render inside 25px/16px image boxes.
- Required approved chat foundation is retained unchanged: `design-references/cloud-site-redesign-20261107/assets/chat-v001.png` → `miniprogram/packages/construction/assets/notebook/xiaok-chat.png` (253×320, 8257 bytes, independently generated through the official OpenAI Images API). Existing back/member/file/chevron glyphs use Lucide/ISC; `notebook-font.less` embeds the existing Noto Serif SC Black subset under the [OFL license](../../../miniprogram/packages/assistant/assets/StudioSerif-OFL.txt). Original prompts, hashes and usage remain in the approved design manifest.
<!-- /site-capture-icons -->

- Approved01 conversation list (2026-11-02): existing independent Lucide/ISC MessageCircleMore geometry from notebook-tab-chat.svg, deep-green stroke #073c30, 48x48 transparent PNG1283B at miniprogram/packages/assistant/assets/conversation-outline.png. Source conversation-outline.svg stays here; no composite UI pixels, AI generation or new business illustration. House remains requirement-home.png; plus, arrow and binding rings are native geometry.

- Notebook chat (2026-10-30): current source `design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/README.md`. Built-in ImageGen independently generated `assets/chat-notebook-mascot.png` (360×329,12,939bytes) and `assets/chat-notebook-sage.png` (160×240,8,619bytes), copied to `miniprogram/packages/assistant/assets/` with true alpha, no WebP/slicing. Original prompts and PNG mapping are in that design directory. Lucide/ISC MessageCircleMore,House,UserRound,ArrowUpRight,CornerDownRight supply `notebook-tab-*`, `chat-arrow-up-right`, `chat-corner-arrow`; independent SVGs are kept here. Fixed headings use a Noto Serif SC Black/OFL subset in `chat/chat-serif.less`, license `assistant/assets/StudioSerif-OFL.txt`. Other pictograms reuse the existing licensed set. Seven supplementary full-screen images are design references only; live photos are authenticated service media. 手账欢迎素材为独立生图，纸层与卡片原生构建；补稿不切片打包，工地／作品摄影不成为运行包静态图片。

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
