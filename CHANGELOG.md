# Changelog

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
