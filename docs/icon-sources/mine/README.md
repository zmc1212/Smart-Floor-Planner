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
- `wallet.png`: `wallet`
- `todo-green.png`, `todo-blue.png`, `todo-orange.png`: `calendar-check` or
  `clipboard-check`
- `clipboard-pen.png`: `clipboard-pen-line`
- `bell.png`: `bell`
- `shield-check.png`: `shield-check`
- `log-out.png`: `log-out`
- `tab-measure-active.png`: rendered at `96x96` from
  `tab-measure-active.svg`; the circular measurement action uses the same
  rounded Lucide ruler language and keeps transparent padding on every edge.
