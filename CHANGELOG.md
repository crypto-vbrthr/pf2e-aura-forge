# Changelog

## 0.3.4

### Remote save routing and PF2e actor-data compatibility
- Added an explicit Foundry module socket channel for save prompts. A single runtime coordinator now detects enter/leave transitions and routes `request` saves to the active player owner even when the GM moved the token or is the PF2e document updater.
- Coordinate-bearing `updateToken` hooks are transition-capable on every client, so remote token movement does not depend on the mover-only canvas interaction hook.
- Save results are returned to the coordinator, which remains responsible for applying the matching Effect Forge outcome exactly once.
- Added a narrow PF2e compatibility guard for malformed legacy/custom physical Items that completely lack `system.description`. Before Aura Forge creates or removes a runtime Effect Item, those missing description objects are normalized to an empty PF2e description object so full Actor data preparation can complete. Existing description content is never changed.
- Added regression coverage for remote player save routing, coordinator-only transition side effects, coordinate update routing, and malformed physical-item repair.

## 0.3.3

### Save routing and runtime hardening
- Fixed `request` saving throws so an active player assigned to or owning the target Actor receives the native PF2e save dialog even when an active GM is present. PF2e document `primaryUpdater` remains appropriate for Actor mutations, but is no longer used as the player-dialog routing rule.
- Automatic saves now select one active GM when available, avoiding duplicate multi-client rolls.
- Reordered enter/leave reconciliation so interactive trigger saves resolve before new Presence Effect Items are created. A data-preparation failure while applying a presence effect therefore no longer suppresses the transition/save itself.
- Presence bindings are now embedded in the Effect Definition `metadata` before calling the public Critical Forge effect-application API. Aura Forge no longer performs a second `setFlag()` update on each created runtime Effect Item.
- Legacy direct Aura Forge `presenceBinding` flags remain readable for cleanup and migration-free compatibility.
- Added runtime warnings for unresolved saving throws and failed presence synchronization.
- Added a mixed-installation fail-fast guard: if `module.json` and the loaded scripts report different Aura Forge versions, runtime initialization stops and Foundry shows a permanent error instead of running an incoherent file mix.
- Added regression coverage for player-vs-GM save routing, automatic-save ownership, metadata-first presence bindings, absence of post-create item mutation, and manifest/script version consistency.

## 0.3.2

### Enter/leave saving throws
- Save-enabled `enter` and `leave` triggers now roll through the target Actor's native PF2e save statistic.
- Added request, automatic, and GM save modes.
- Native PF2e degree of success dispatches the matching Critical Success, Success, Failure, or Critical Failure Effect Forge outcome.
- Occupancy is committed before awaiting an interactive save so another reconciliation cannot request the same transition twice.
- Added save-resolution and runtime regression coverage.

## 0.3.1

- Fixed presence effects being evaluated against stale animated token positions, which could invert enter/leave behavior.
- Fixed saving-throw and temporary-immunity checkboxes being reset while saving trigger cards.
- Actor aura proxy abilities now carry the PF2e `aura` trait and an empty native `Aura` rule element for canvas visualization; Aura Forge runtime remains authoritative for effects.
- Native aura visualization follows the actor-instance enabled state and radius override.

## 0.3.0

### Runtime Engine: Presence Effects + Enter/Leave
- Connected active Actor Aura Instances to live scene-token runtime reconciliation.
- Presence Effects now apply automatically while matching targets are inside range and are removed when no longer applicable.
- Presence bindings are persisted on the created PF2e Effect Items so reload, radius changes, target changes, source deletion, and definition edits can be reconciled from current state.
- Presence effect definitions are fingerprinted; edited definitions replace stale bound runtime effects instead of silently keeping old mechanics.
- Added enter/leave transition tracking without firing synthetic enter events during initial scene reconstruction.
- Triggers without a save execute the Success outcome as their direct event effect; the editor now explains this convention.
- Save-enabled triggers are detected and explicitly deferred to the next save/immunity runtime milestone.
- Runtime writes are gated to the PF2e Actor primary updater to prevent multi-client duplicate application.
- Added Foundry v14 canvas/token/actor/library runtime hooks, including the all-client `moveToken` movement hook and scene-teardown cleanup.
- Added runtime diagnostics through the additive `api.engine` contract.
- Added runtime, spatial, transition, hook, ownership, reconstruction, replacement, and cleanup regression coverage.

## 0.2.4

### Aura Editor scrolling regression fix
- Restored the main Aura Editor as an explicit vertical scroll container with stable scrollbar space.
- Prevented CSS Grid from shrinking framed editor domains below their content height.
- Removed clipping from the major editor group frames so fields and embedded Effect Editor content remain visible.
- Preserved the rounded framed title rails without relying on section-level overflow clipping.
- Added regression coverage for the scroll-layout contract.

## 0.2.3

### Theme-safe editor frames
- Strengthened the major Aura Editor frames with theme-safe border fallbacks and a visible accent rail.
- Avoided reliance on legacy Foundry border variables for the primary editor grouping.

## 0.2.2

### Aura Editor visual grouping
- Added stronger framed editor domains for basic data, targeting, Actor assignments, presence effects, and event triggers.
- Added consistent title rails with dedicated icons so the major Aura Editor areas can be recognized at a glance.
- Kept the styling within Foundry's existing palette and left the embedded Effect Editor theme untouched.
- Added regression coverage for the semantic section classes and shared visual-grouping styles.

## 0.2.1

### Actor Assignment polish
- Added drag-and-drop assignment from the Foundry Actor Directory directly into Aura Forge.
- Assigned auras now create a managed PF2e passive ability on the Actor so they appear in the Actor's abilities list.
- Aura instances remain lightweight flags and central Aura Definitions remain the source of truth; the owned ability is a sheet-visible proxy.
- Existing 0.2.0 flag-only assignments are reconciled on `ready` and receive their missing passive ability automatically.
- Saving a central Aura Definition refreshes the matching Actor abilities, including name and description.
- Removing an assignment or deleting an Aura Definition removes the matching managed Actor ability.
- Added regression coverage for drag/drop wiring, passive ability shape, legacy reconciliation, synchronization, and cleanup.

## 0.2.0

### Actor Assignment & Aura Instances
- Added lightweight Actor-scoped Aura Instances referencing central Aura Definitions.
- Added assignment from Aura Forge to a selected world Actor.
- Added shortcut for assigning to exactly one selected token/world Actor.
- Added per-instance enable/disable and radius override controls.
- Added assignment removal without deleting the definition.
- Aura deletion now cleans Actor references.
- Added additive `api.instances` public API.
- Added instance resolution for the future runtime Aura Engine.
- Added regression tests for instance storage, duplicate prevention, overrides, resolution, cleanup, and UI separation.

## 0.1.3
- Embedded Effect Editor inherits the standalone Effect Forge theme scope and panel styling.

## 0.1.2
- Increased the default Aura Forge window size for the embedded Effect Editor.

## 0.1.1
- Preserved scroll position across action re-renders.
- Embedded the Effect Editor inline at the effect being edited.

## 0.1.0
- Aura Core & Editor Foundation.
