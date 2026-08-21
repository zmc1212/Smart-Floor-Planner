# Mine icon source

The Mine/workbench action icons in `miniprogram/images/mine-icons/` use the
Lucide rounded outline language. `mine-icons.svg` keeps editable vector source
symbols for the action, task, account, and navigation metaphors used by the
page. The symbols use a `24x24` view box, rounded caps/joins, and a `1.9`
stroke.

The shipped PNG files are local raster exports sized for the Mini Program's
logical display dimensions. They are optimized to stay within the Mini Program
design contract's `10KB` micro-icon budget. Status variants may recolor the
same base geometry without changing the icon family.

Source: [Lucide](https://lucide.dev/)

License: `LICENSE.md`

## Mine v6 reference crops

`miniprogram/images/mine-v6/` contains the profile scene and fallback avatar,
three summary-card illustrations, four workbench illustrations, two todo
thumbnails, AI banner image, settings control, and an unused rectangular
center-tab reference crop from the user-provided
`design-references/mine/miniprogram-mine-v6.png` and
`design-references/mine/miniprogram-mine-v6-icon.png`. These are page-specific visual
assets rather than additions to the Lucide icon set; the original references
are the editable sources and retain their supplied asset rights.

## Mapping

- `building.png`: `building`
- `buildingCog.png`: `building` + `cog`
- `bulb.png`: `lightbulb`
- `deal.png`: `handshake`
- `edit.png`: `pencil`
- `home.png`: `house`
- `search.png`: `search`
- `user.png`: `user`
- `users.png`: `users`
- `earn-g.png`, `earn-a.png`: `tab-earnings.svg`, rendered
  at `96x96`; the inactive and active variants use the same wallet-and-income
  geometry for the earnings and commission TabBar items.
- `book-g.png`, `book-a-active.png`: `tab-appointment.svg`,
  rendered at `96x96`; the calendar-check geometry is reserved for the
  enterprise Appointments TabBar item.
- `todo-green.png`, `todo-blue.png`, `todo-orange.png`: `calendar-check` or
  `clipboard-check`
- `clipboard-pen.png`: `clipboard-pen-line`
- `bell.png`: `bell`
- `scan.png`: `scan-line`
- `shield-check.png`: `shield-check`
- `log-out.png`: `log-out`
- `tab-ai.png`, `tab-ai-active.png`: `sparkles`, rendered at `96x96` from the
  matching editable SVG sources for the AI Design primary tab.
- `tab-measure-active.png`: rendered at `96x96` from
  `tab-measure-active.svg`; the circular measurement action uses the same
  rounded Lucide ruler language and keeps transparent padding on every edge.
- `mine-v6/tab-create.png`: an unused compact green rounded-rectangle reference
  crop. The product keeps the established circular `tab-measure-active.png`
  treatment for the formal measurement entry.
