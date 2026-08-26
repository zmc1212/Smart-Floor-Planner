# Free Design Service Contact Conversion Design

## Approved outcome

The assigned-designer success state opens with a one-time contact-conversion moment and then becomes an archive-first result page. After dismissal, the service archive is the dominant subject, information group, and only filled action. Designer WeChat remains an optional compact supporting action and must never gate the archive.

## Interaction contract

- When a new claim resolves directly into `success` and the assigned designer has a QR code or WeChat ID, open the shared `designer-contact-sheet` once in that page lifecycle. Closing it must not trigger another automatic open.
- A designer with only a WeChat ID uses the same sheet's copy-first state. Missing contact data does not open an empty dialog; the page exposes a disabled synchronization state instead.
- The shared dialog remains the only QR and WeChat-ID presentation on this route. The result page must not render a second QR, copy row, or large duplicate communication path.
- After dismissal, the archive Hero owns the solid-green `查看服务档案` action. A compact `查看微信` control inside the designer card reopens the sheet; it is not a second full-width CTA. The existing weak service-needs entry remains last.
- The existing-attribution state is not an automatic contact interruption. It keeps its current service-record-first hierarchy and may open the same sheet only after an explicit contact action.

## Visual structure

- This document is the route's single canonical composed source. The approved success composition is `design-references/free-design-service-archive-first-v1/free-design-service-success-archive-first-v1.png`; phone authorization and the shared contact dialog retain their already approved state-specific compositions without becoming additional ledger sources.
- In the shared contact dialog, Xiao K says `比小红书更方便贴心的 / 家装顾问` from a native-text warm-white bubble to the mascot's right. The dialog resolves the native menu-button bottom on attach/open and keeps the bubble below that capsule-safe boundary. The relationship pill reads only `你的专属家装设计顾问` when the title is visible. The credential heading combines the resolved title and designer name; licensed medal, compass, and customer-heart icons label title, experience, and customers served without changing the QR-stage size. If title visibility is disabled, the title heading collapses and the designer name returns to the relationship pill.
- Remove the acquisition stepper and every home-visit, surveying, appointment, address, or designer-matching prompt from phone authorization. Its first viewport uses `装修问题找微信家装顾问，免费问清楚` and shows only the three benefits `免费效果图 / 出到客户满意为止`, `免费家装设计顾问 / 解答你的装修问题`, and `免费家装现场顾问 / 解答现场问题`, followed by the phone privacy note, primary `允许微信授权手机号`, and weak `暂不授权` action.
- The phone-authorization Hero and benefit list form one content-intrinsic reading group. Neither the outer pass nor its artwork stage may use flex growth or a viewport-derived minimum height to consume tall-screen space. Xiao K must end immediately above the first benefit row with the source's normal section gap; the repeated rows and icons keep source-proportional size. Short viewports scroll the whole state rather than compressing this group.
- At the `390x844` baseline, the source-matched optical scale is: `26rpx` benefit pill, `48rpx` Hero title, `28rpx` Hero subtitle, `36rpx` benefit labels, `28rpx` benefit helpers, `124rpx` icon circles with `78–88rpx` visible glyph boxes, `28rpx` privacy copy, and a `32rpx` authorization CTA. These are restoration targets for this state, not global typography minima; narrow screens may use the documented reduced overrides without shrinking the business labels/helpers below their route targets.
- The post-authorization success state shows the three completed labels as `领取完成 / 授权完成 / 顾问已匹配`; pending assignment and existing-attribution states retain their current contracts.
- The dominant archive Hero uses `你的服务档案已建立` and `量房、户型、方案与服务进度，都在这里持续更新`. Its neutral directory rows are `服务进度 / 户型档案 / 设计方案`; every row and the single filled `查看服务档案` CTA enter the same existing archive route and do not imply per-row completion states.
- The approved composite's Xiao K holding a dossier maps to the independently generated transparent production asset `packages/business/assets/referral-service-v1/xiao-k-service-archive-guide.png`. The page background, native text, directory rows, icons, and controls remain native WXML/Less and are never sliced from the composite.
- The compact supporting designer card contains the assigned name, fixed customer-facing role `家装设计顾问`, honest `已匹配` state, and the small `查看微信` control. A tall-device runtime capture confirmed that native-button auto width can squeeze the role copy, so production pins this supporting touch target to `148rpx` (`132rpx` on narrow screens) and gives the remaining width to the name/role block; it must never expand into a half-card or full-width action. The card removes the generic `量房预约与方案沟通可通过微信联系`-style helper because customers can initiate booking and review plans in the platform.
- The former helper strip is replaced only when real `professionalProfile` data exists: visible title, `experienceLabel`, and `serviceLabel` render with the already licensed badge/experience/service icons. Missing fields collapse individually; a missing profile collapses the whole proof strip rather than inventing years, title, or service counts.
- Source-calibrated success-state ledger at `390x844`: completed step dots/labels `44/24rpx`; archive title/helper `44/26rpx`; Xiao K `258×282rpx`; directory rows `94rpx`, icon containers/glyphs `62/38rpx`; archive CTA height/copy `100/30rpx`; designer name/role/status/contact `32/24/22/24rpx` with a `148rpx` contact-button width; proof copy/icons `22/34rpx`, with the third service proof owning the next row and aligning to column one; tertiary zone/link `148/26rpx`.
- Xiao K appears once as the archive guide and does not repeat in the designer card or compete with the shared contact dialog.

## Boundaries

- Preserve the route, APIs, claim idempotency, customer-session refresh, designer payload, permissions, service archive navigation, and service-needs navigation.
- The Mini Program cannot verify whether a personal WeChat friend request succeeded; do not persist or claim an `已添加` state.
- Use native WXML/Less and the existing shared centered-dialog motion. The phone-authorization Hero's standalone transparent Xiao K three-benefit artwork is `packages/business/assets/referral-service-v1/xiao-k-three-benefits.png`; the success Hero uses `xiao-k-service-archive-guide.png`. Page structure, copy, archive rows, proof data, privacy text, and controls remain native rather than image-embedded.
