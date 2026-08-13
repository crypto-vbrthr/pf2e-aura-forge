# PF2E Aura Forge

Aura Forge is the aura-definition, assignment, and runtime layer for the Forge Suite. Version 1.0.0-rc.2 extends the release candidate with Critical Forge 1.0.1-rc.3 instant-component integration for one-shot damage and immediate death. The public API remains at 0.5.0 and both Aura Definition and Aura Instance schemas remain at version 1.

## Included

- Stable Aura Definition schema (`schemaVersion: 1`).
- Separate `presenceEffects` and discrete event `triggers`.
- Embedded PF2E Critical Forge Effect Editor for all effect payloads, including one-shot Damage and immediate Death components from Critical Forge 1.0.1-rc.3.
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
- `enter` and `leave` transitions execute event effects for triggers without a saving throw. Event outcomes may mix persistent components with one-shot typed damage and immediate death; instant components execute once for the claimed aura event.
- Save-enabled `enter` and `leave` triggers use native PF2e saves and dispatch the matching degree-of-success outcome.
- `request` mode explicitly routes the native PF2e roll dialog over the Aura Forge module socket to the active player assigned to or owning the target Actor, even if another client moved the token. `automatic` mode prefers one active GM; `gm` mode runs on that GM.
- Runtime side effects and automatic Actor proxy reconciliation are owned by exactly one client per target Actor: PF2e `primaryUpdater` when available, with deterministic owner/GM fallbacks only when PF2e exposes no updater. Unchanged proxy abilities are not rewritten.
- Before mutating runtime Effect Items, Aura Forge narrowly repairs PF2e physical Items that are structurally missing `system.description`, preventing unrelated malformed legacy/custom equipment from aborting the Actor reset triggered by effect creation.
- Scene, token, actor-instance, targeting, radius, and library changes automatically schedule runtime reconciliation.
- `api.engine.reconcileScene()`, `api.engine.deactivateScene()`, and `api.engine.status()` are available as additive diagnostics/runtime controls.

## Critical Forge requirement

Aura Forge 1.0.0-rc.2 requires **PF2E Critical Forge 1.0.1-rc.3 or newer** and public Effect API **0.9.6 or newer**. This is the first Critical Forge API generation that contains both instant Damage and immediate Death execution.

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

Presence Effects deliberately do **not** execute instant Effect Engine components. Damage and Death are one-shot event semantics, so Aura validation rejects them inside `presenceEffects`, and runtime additionally calls Critical Forge with `executeInstant: false` as a safety net. Put those components in an event outcome such as Enter, Turn Start, or Turn End instead.

For a trigger **without** a saving throw, the `success` outcome slot is the direct event effect. Aura Forge passes the exact target Token to Critical Forge and explicitly enables instant execution, so typed damage uses the correct token-specific PF2e damage workflow and `death` resolves through the Effect Engine exactly once for that event. For a trigger **with** a saving throw, the target Actor's single runtime updater owns the event and routes an owner-facing roll over the module socket when required. The resolver calls the target Actor's native PF2e save statistic and returns the degree before the owning client applies the matching Effect Forge outcome. Closing that dialog or losing the remote resolver does not opt the target out: the runtime writer performs one automatic native PF2e fallback roll. `turnStart` and `turnEnd` use the same ownership path. Temporary immunities are visible PF2e Effect Items with their configured duration and are checked before a new aura event begins. If one trigger grants immunity, sibling triggers belonging to that same already-started event still resolve; the immunity applies to subsequent events and to the post-event Presence pass.

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

// Pure current-contract Presence planning for external Forge consumers:
const plan = api.engine.planPresenceRuntime({
  sceneId: canvas.scene.id,
  aura,
  instanceId: instance.id,
  sourceTokenId: token.id,
  candidates,
  activeBindings,
  isInside: (candidate) => candidate.inside,
  isPresenceBlocked: (candidate) => candidate.auraImmune
});
```

`api.engine.planPresence()` auto-selects the current `runtime-v1` contract when `sceneId`/`instanceId` are supplied. The pre-runtime token-bound shape remains accepted for compatibility and is available explicitly as `planPresenceLegacy()`.

## Current runtime boundary

This release executes Presence Effects plus save/no-save `enter`, `leave`, `turnStart`, and `turnEnd` triggers. Temporary immunity can be granted on configured degrees of success, persists as a PF2e Effect Item, and blocks matching aura event triggers until it expires. Minute/hour/day immunity also has a world-time fallback check; round-based expiry follows PF2e effect-duration state. Spatial membership evaluates the current token positions. A movement whose start and end are both outside an aura does not synthesize `enter`/`leave` merely because its animation/path crossed the radius. The runtime also does not yet reproduce PF2e's native aura-square wall/sensory-trait blocking. Hidden-token exclusion follows the native PF2e aura membership rule. Runtime operations are serialized per scene, queued work is cancelled during canvas teardown, and combat-event claims are keyed by combatant/token identity rather than mutable initiative indexes.

### Clean-install guard

Aura Forge compares the manifest version with the version compiled into its scripts during `ready`. If they differ, runtime initialization stops and a permanent Foundry notification asks for a clean reinstall. This prevents stale files from an older Aura Forge release from being mixed with a newer runtime.
