# Free Design Service Contact Conversion Design

## Approved outcome

The assigned-designer success state opens with a contact-conversion moment and then becomes a service result page. The automatic dialog makes the designer's WeChat contact prominent once; after dismissal, the customer's primary next task is entering the service archive. Adding WeChat remains optional and must never gate the archive.

## Interaction contract

- When a new claim resolves directly into `success` and the assigned designer has a QR code or WeChat ID, open the shared `designer-contact-sheet` once in that page lifecycle. Closing it must not trigger another automatic open.
- A designer with only a WeChat ID uses the same sheet's copy-first state. Missing contact data does not open an empty dialog; the page exposes a disabled synchronization state instead.
- The shared dialog remains the only QR and WeChat-ID presentation on this route. The result page must not render a second QR, copy row, or large duplicate communication path.
- After dismissal, the result page puts the solid-green `查看服务档案` action first. A secondary outlined `查看设计师微信` action reopens the sheet, using neutral wording because the Mini Program cannot know whether the friend request already succeeded. The existing weak service-needs entry remains last.
- The existing-attribution state is not an automatic contact interruption. It keeps its current service-record-first hierarchy and may open the same sheet only after an explicit contact action.

## Visual structure

- This document is the route's canonical composed source. The phone-authorization state uses `design-references/free-design-service-phone-auth-three-benefits-v1/free-design-service-phone-auth-three-benefits-v1.png`; the shared contact dialog uses `design-references/designer-contact-sheet/designer-contact-sheet-professional-card-v7.png`.
- In the shared contact dialog, the relationship pill reads only `你的专属设计师` when the title is visible. The credential heading combines the resolved title and designer name; licensed medal, compass, and customer-heart icons label title, experience, and customers served without changing the QR-stage size. If title visibility is disabled, the title heading collapses and the designer name returns to the relationship pill.
- Remove the acquisition stepper and every home-visit, surveying, appointment, address, or designer-matching prompt from phone authorization. Its first viewport uses `装修问题找微信家装顾问，免费问清楚` and shows only the three benefits `免费效果图 / 出到客户满意为止`, `免费设计顾问 / 解答你的装修问题`, and `免费现场顾问 / 解答现场问题`, followed by the phone privacy note, primary `允许微信授权手机号`, and weak `暂不授权` action.
- The phone-authorization Hero and benefit list form one content-intrinsic reading group. Neither the outer pass nor its artwork stage may use flex growth or a viewport-derived minimum height to consume tall-screen space. Xiao K must end immediately above the first benefit row with the source's normal section gap; the repeated rows and icons keep source-proportional size. Short viewports scroll the whole state rather than compressing this group.
- At the `390x844` baseline, the source-matched optical scale is: `26rpx` benefit pill, `48rpx` Hero title, `28rpx` Hero subtitle, `36rpx` benefit labels, `28rpx` benefit helpers, `124rpx` icon circles with `78–88rpx` visible glyph boxes, `28rpx` privacy copy, and a `32rpx` authorization CTA. These are restoration targets for this state, not global typography minima; narrow screens may use the documented reduced overrides without shrinking the business labels/helpers below their route targets.
- The post-authorization success state still shows service claim, phone authorization, and designer matching as complete; pending assignment and existing-attribution states retain their current contracts.
- Use the compact success Hero for `设计师已为你匹配` and the neutral result copy `服务档案已建立，后续进度可随时查看`; the designer summary below explains the WeChat communication purpose without assuming whether contact is already complete.
- Replace the former QR card and separate next-step card with one compact designer summary card: avatar, assigned designer name, `专属设计师`, an honest matched status, and the communication purpose. The action group follows the card in primary archive / secondary contact order.
- Keep Xiao K as the successful handoff guide in the Hero; the mascot does not repeat inside the summary card or compete with the shared contact dialog.

## Boundaries

- Preserve the route, APIs, claim idempotency, customer-session refresh, designer payload, permissions, service archive navigation, and service-needs navigation.
- The Mini Program cannot verify whether a personal WeChat friend request succeeded; do not persist or claim an `已添加` state.
- Use native WXML/Less and the existing shared centered-dialog motion. The phone-authorization Hero's standalone transparent Xiao K three-benefit artwork is `packages/business/assets/referral-service-v1/xiao-k-three-benefits.png`; page structure, copy, benefit rows, privacy text, and controls remain native rather than image-embedded.
