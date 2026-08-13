# PF2E Aura Forge

Aura Forge is the aura-definition, assignment, and runtime layer for the Forge Suite. Version 0.5.0 adds the **Embedded Aura Editor Refactor & Public UI API** while preserving the existing runtime, library, instance, and engine contracts.

## Included

- Stable Aura Definition schema (`schemaVersion: 1`).
- Separate `presenceEffects` and discrete event `triggers`.
- Embedded PF2E Critical Forge Effect Editor for all effect payloads.
- **One shared embedded Aura Editor surface** for basic data, targeting, Presence Effects, and event triggers. The standalone Aura Forge uses the same component exposed to other modules.
- **Additive `api.ui.auraEditor` API** with session, mount/render, and context helpers for consumers such as Creature Forge.
- World-scoped Aura Library with create, edit, duplicate, and delete workflows.
- Actor-scoped Aura Instances stored as module flags on Actor documents.
- Drag-and-drop Actor assignment and managed passive PF2e ability proxies on Actor sheets.
- Per-instance enable/disable state and optional radius override.
- **Live runtime detection for active Aura Instances on scene tokens.**
- **Presence Effects are automatically applied while a valid target is inside the aura and removed on exit.**
- Presence Effects are reconstructed from current scene state after reload instead of depending on a historical enter event.
- Presence runtime items carry their exact Aura Forge binding inside the Critical Forge Effect Definition metadata, so only the effect created by that aura/presence/source is removed and no post-create item flag update is required.
- Changing a Presence Effect replaces the bound runtime effect on the next reconciliation.
- `enter` and `leave` transitions execute event effects for triggers without a saving throw.
- Save-enabled `enter` and `leave` triggers use native PF2e saves and dispatch the matching degree-of-success outcome.
- `request` mode explicitly routes the native PF2e roll dialog over the Aura Forge module socket to the active player assigned to or owning the target Actor, even if another client moved the token. `automatic` mode prefers one active GM; `gm` mode runs on that GM.
- Runtime side effects are owned by exactly one client per target Actor: PF2e `primaryUpdater` when available, with Aura Forge's deterministic coordinator only as a fallback. This keeps active-GM games single-writer while also supporting no-GM/player-owned sessions.
- Before mutating runtime Effect Items, Aura Forge narrowly repairs PF2e physical Items that are structurally missing `system.description`, preventing unrelated malformed legacy/custom equipment from aborting the Actor reset triggered by effect creation.
- Scene, token, actor-instance, targeting, radius, and library changes automatically schedule runtime reconciliation.
- `api.engine.reconcileScene()`, `api.engine.deactivateScene()`, and `api.engine.status()` are available as additive diagnostics/runtime controls.

## Definition vs. instance

Aura Definitions live in the Aura Library. Actor assignments are lightweight instances which reference a definition by ID:

```js
{
  schemaVersion: 1,
  id: "aura-instance....",
  definitionId: "aura....",
  definitionName: "Aura of Dread",
  enabled: true,
  overrides: { radius: null }
}
```

Changing the central Aura Definition therefore changes what every assigned Actor resolves to, while instance state and overrides stay Actor-specific. The owned passive ability is only a synchronized sheet-visible representation and never replaces the central definition or instance flag.


### Native PF2e canvas aura

Assigned actor abilities carry the PF2e `aura` trait and an empty native `Aura` rule element. This lets PF2e render the aura radius on the canvas while Aura Forge remains responsible for presence effects and event automation. The native radius follows the actor instance radius override and disappears when that instance is disabled.

## Runtime model

```text
Actor Aura Instance
        ↓
Scene source Token
        ↓
resolved Aura Definition + radius override
        ↓
matching Tokens inside range
        ├─ Presence Effects → Effect Forge → bound PF2e Effect Items
        └─ Enter / Leave
             ├─ no save → Success outcome
             └─ save    → PF2e save → degree outcome
```

The runtime prefers PF2e's Token placeable `distanceTo()` measurement, matching the system's own initial aura range check. A rectangle/grid fallback exists for degraded/test contexts. Presence effects are forced to unlimited global duration because their lifetime is controlled by aura membership, then removed by their exact Aura Forge binding when no longer desired. The binding is inserted into the Effect Definition metadata before Critical Forge creates the PF2e Effect Item, avoiding a second Actor/Item update solely for runtime tagging.

For a trigger **without** a saving throw, the `success` outcome slot is the direct event effect. For a trigger **with** a saving throw, the target Actor's single runtime updater owns the event and routes an owner-facing roll over the module socket when required. The resolver calls the target Actor's native PF2e save statistic and returns the degree before the owning client applies the matching Effect Forge outcome. `turnStart` and `turnEnd` use the same ownership path. Temporary immunities are visible PF2e Effect Items with their configured duration and are checked before a new aura event begins. If one trigger grants immunity, sibling triggers belonging to that same already-started event still resolve; the immunity applies to subsequent events and to the post-event Presence pass.

## Embedded Aura Editor API

The Aura Editor edits only an `AuraDefinition`. It does **not** save to the Aura Library, assign Actors, apply effects immediately, or own any container lifecycle. Those responsibilities stay with the host module. The standalone Aura Forge itself is the reference consumer of this API.

```js
const auraApi = game.modules.get("pf2e-aura-forge")?.api;
const definition = await auraApi.library.get("AURA_ID");

const session = auraApi.ui.auraEditor.createSession(definition, {
  context: { usage: "creature-forge" }
});

const editor = auraApi.ui.auraEditor.create({
  session,
  context: { usage: "creature-forge" },
  onChange: () => console.log(editor.value)
});

await editor.mount(containerElement, { layout: "full" });
const editedAura = editor.value;
editor.unmount();
```

`api.ui.openAuraForge()` remains unchanged. Actor assignment and the Aura Library remain container-level features and therefore are intentionally not part of the embedded editor.

## Public API

```js
const api = game.modules.get("pf2e-aura-forge")?.api;
const actor = game.actors.get("ACTOR_ID");
const aura = await api.library.get("AURA_ID");

const instance = await api.instances.assign(actor, aura.id);
await api.instances.setEnabled(actor, instance.id, false);
await api.instances.setRadiusOverride(actor, instance.id, 20);

await api.engine.reconcileScene(canvas.scene, { fireEvents: false });
console.log(api.engine.status());
```

## Current runtime boundary

This release executes Presence Effects plus save/no-save `enter`, `leave`, `turnStart`, and `turnEnd` triggers. Temporary immunity can be granted on configured degrees of success, persists as a PF2e Effect Item, and blocks matching aura event triggers until it expires. Minute/hour/day immunity also has a world-time fallback check; round-based expiry follows PF2e effect-duration state. The runtime still does not reproduce PF2e's native aura-square wall/sensory-trait blocking; spatial membership uses PF2e token distance. Hidden-token exclusion follows the native PF2e aura membership rule. Runtime operations are serialized per scene, queued work is cancelled during canvas teardown, and combat-event claims are keyed by combatant/token identity rather than mutable initiative indexes.

### Clean-install guard

Aura Forge compares the manifest version with the version compiled into its scripts during `ready`. If they differ, runtime initialization stops and a permanent Foundry notification asks for a clean reinstall. This prevents stale files from an older Aura Forge release from being mixed with a newer runtime.
