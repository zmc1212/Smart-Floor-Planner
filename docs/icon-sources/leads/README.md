# Leads page visual assets

The production crops under `miniprogram/images/leads-v4/` are derived from the
user-supplied `design-references/leads/leads-management-v4-icon.png`. They include the
header and summary scenes plus the exact control/status micro-icons used by the
v4 reference. Labels, customer data, status text, and navigation remain native
WXML/WXSS.

All control and status icon crops remain below the Mini Program 10KB micro-icon
budget. The source sheet is project-owned artwork supplied by the user; no
third-party icon package is shipped for this page.

The four sample floor-plan crops are retained under
`design-references/leads/crops/` for design comparison only. They
are not shipped in the Mini Program or used as lead-card placeholders. Runtime
cards use `externalSource.previewUrl` or draw the associated formal wall graph.
