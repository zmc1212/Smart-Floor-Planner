# `legacy-kernel.js` Phase 7 Governance Closure

> Status: Implemented
>
> Checked: 2026-09-04
>
> External contract: unchanged

## Final boundaries

`miniprogram/packages/surveying/utils` is the authoritative runtime source. The public
`surveyWallGraph.js` facade binds every exported name to one explicit owner. The 97-line
`survey/legacy-kernel.js` file remains only as a 64-name compatibility entry and is not
reachable from the production facade. Admin consumes a committed generated mirror whose
79 files and SHA-256 manifest are checked against the Mini Program source.

| Boundary | Responsibility | Forbidden dependency or behavior |
| --- | --- | --- |
| `core/` | graph/session data primitives, IDs and graph queries | editor, BLE, host UI |
| `geometry/` | graph-free vector, segment and polygon math | every non-geometry kernel layer and host global |
| `domain/` | wall/opening/space semantics, validation inputs and error codes | editor feedback or persistence |
| `topology/` | boundaries, faces, closure plans and Space synchronization | host UI and database writes |
| `read-model/` | immutable wall, face, cursor, boundary and dimension projections | operations, interaction, snap, compat or legacy kernel |
| `session/` | field ownership and legal state transitions | graph persistence |
| `snap/`, `interaction/` | deterministic candidates and read-only user intentions | graph persistence, clock/ID allocation and host feedback |
| `operations/` | mutation planning and the only graph-application boundary | WeChat, BLE or Admin dependencies |
| `compat/` | legacy query/error adaptation | new domain behavior |
| editor / API adapters | device, gesture, Toast, BLE queue, authorization and storage | reimplementing geometry or topology |

## Write path and invariant ownership

The formal write path is:

```text
editor or BLE event
  -> surveyWallGraph facade
  -> interaction/snap intention
  -> operation plan
  -> isolated transaction draft
  -> topology/Space synchronization
  -> quick or full invariant validation
  -> version-4 layout serialization
  -> authorized API/database write
```

Pure geometry owns numerical relations. Domain modules own wall/opening/space semantics.
Topology owns face and closed-Space consistency. `session/state-machine.js` owns legal
session transitions, while `invariants/floor-plan-validator.js` owns final graph/session
reference validation. Operations own mutation atomicity and measurement audit equations.
Server adapters own the exact version-4 envelope, tenant authorization and persistence.
Read models never repair, mutate or persist their input.

## Long-term guards

`survey-kernel-phase7-governance.test.js` and the non-bypassable policy in
`scripts/audit-survey-kernel.js` reject:

- geometry or read-model upward dependencies on operations, interaction, snap, compat,
  the facade, legacy kernel, editor, BLE, `wx`, or browser globals;
- any cycle in the surveyed CommonJS module graph;
- multiple export objects, implicit/spread bindings, duplicate export names, or runtime
  exports without a corresponding explicit binding;
- any production dependency into `legacy-kernel.js` or return of domain function bodies
  to that compatibility entry;
- a missing, stale, extra or content-divergent Admin mirror/manifest entry.

Run `npm --prefix miniprogram run check:survey-kernel-architecture` while developing a
kernel change. Before handoff run `npm --prefix miniprogram run test:survey-kernel-phase7`;
it includes the source snapshot, architecture rules, all surveying/editor tests, H5 tests
and build, Admin mirror check, and performance gate. Run the complete Mini Program suite
and `git diff --check` according to the repository verification policy.

Closure verification passed 5 Phase 7 governance tests, 1,117 surveying/editor tests,
55 H5 tests plus its production build, 39 Admin survey consumers, the 79-file mirror check,
and all recorded performance thresholds. The complete Mini Program suite passed 1,606 of
1,620 tests; its 14 failures match the Phase 0 names exactly and remain outside surveying.

## Adding new behavior

Place pure formulas in `geometry/` or `domain/`; topology queries/plans in `topology/`;
read-only projections in `read-model/`; user intent and snapping policy in `interaction/`
or `snap/`; and every graph mutation in `operations/` through the existing transaction and
validator. Keep WeChat/BLE concerns in the editor and server authorization/persistence in
API adapters. A new facade capability requires one explicit owner and export-contract test.
An Admin consumer must first change the Mini Program authority, then regenerate and verify
the committed mirror.

Tests scale with the boundary: pure functions need edge/degenerate and determinism checks;
read models need input immutability and Mini/Admin parity; topology and mutations need
frozen semantic comparison; mutations additionally need success/failure atomicity,
validator, repeat, undo/redo and audit conservation; interaction needs state-transition and
snap-priority coverage. Contract changes still require the bilingual module inventories.

## Retained compatibility limits

The 64 legacy CommonJS names and 13 legacy error/return proxies remain until a separately
approved public-contract change proves their callers can be removed. Admin remains a
generated, committed read-only runtime mirror rather than importing Mini Program files at
deployment time. These limits do not create a second implementation source.
