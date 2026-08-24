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

- This document is the route's canonical composed source. It retains `design-references/free-design-service-phone-auth-redesign-v1/free-design-service-phone-auth-v1.png` for the phone-authorization state and `design-references/designer-contact-sheet/designer-contact-sheet-longpress-market-v5.png` for the shared contact dialog.
- Show all three acquisition steps as complete.
- Use the compact success Hero for `设计师已为你匹配` and the neutral result copy `服务档案已建立，后续进度可随时查看`; the designer summary below explains the WeChat communication purpose without assuming whether contact is already complete.
- Replace the former QR card and separate next-step card with one compact designer summary card: avatar, assigned designer name, `专属设计师`, an honest matched status, and the communication purpose. The action group follows the card in primary archive / secondary contact order.
- Keep Xiao K as the successful handoff guide in the Hero; the mascot does not repeat inside the summary card or compete with the shared contact dialog.

## Boundaries

- Preserve the route, APIs, claim idempotency, customer-session refresh, designer payload, permissions, service archive navigation, and service-needs navigation.
- The Mini Program cannot verify whether a personal WeChat friend request succeeded; do not persist or claim an `已添加` state.
- Use native WXML/Less and the existing shared centered-dialog motion. No new runtime artwork is required.
