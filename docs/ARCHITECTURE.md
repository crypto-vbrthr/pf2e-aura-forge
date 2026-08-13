# Aura Forge Architecture

## Layers

```text
Aura Library
└── AuraDefinition (central reusable template)

Actor
├── flags.pf2e-aura-forge.auraInstances[]
│   └── AuraInstance (reference + enabled state + overrides)
└── Item[type=action, actionType=passive]
    └── managed Aura ability proxy for sheet visibility

Aura Runtime Engine
├── resolve active Actor instances on scene source tokens
├── spatial + target eligibility
├── discrete enter/leave/turnStart/turnEnd event processing
├── one-shot Effect Engine damage/death execution at event boundaries
├── temporary-immunity lifecycle
├── desired Presence Effect reconciliation
└── Effect Forge public application API
```

Aura Definitions own targeting, presence effects, triggers, saves, temporary immunity policy, and Effect Forge payloads. Aura Instances do not copy those definitions. They reference `definitionId` and hold only Actor-specific state. A managed passive PF2e ability mirrors the aura name/description on the Actor sheet; it contains no runtime authority and is recreated from the instance/definition if missing.


## Shared editor layer

```text
AuraForgeApp (standalone container)
├── Aura Library browser
├── Actor assignment / Aura Instances
├── Save / duplicate / delete
└── EmbeddedAuraEditor
    ├── Basic data
    ├── Targeting
    ├── Presence Effects
    │   └── Critical Forge Embedded Effect Editor
    └── Event triggers
        └── Critical Forge Embedded Effect Editor

Creature Forge / other consumer
└── the same EmbeddedAuraEditor
```

`AuraEditorSession` owns the editable `AuraDefinition`, dirty state, validation result, and consumer context. `EmbeddedAuraEditor` owns only Aura-definition editing UI and nested Effect Editor sessions. It deliberately has no Aura Library persistence, Actor assignment, runtime-application, or document-save buttons. The host container decides what happens to `editor.value`.

The public editor contract is `api.ui.auraEditor` with `createSession`, `create`, `render`, `prepareContext`, and `template`. The 1.0 release candidate retains the hardened 0.5.1 engine contract: `api.engine.planPresenceRuntime()` models the live actor-bound Presence identity directly, while `planPresence()` auto-selects that contract when scene/instance identity is supplied and still accepts the legacy token-bound shape for compatibility.

## Aura Instance schema v1

```js
{
  schemaVersion: 1,
  id,
  definitionId,
  definitionName,
  enabled,
  overrides: {
    radius: null | number
  }
}
```

`definitionName` is a display snapshot only. `definitionId` is authoritative.

## Runtime resolution

Each scene token whose Actor owns an enabled Aura Instance becomes an emitter. The current central Aura Definition is resolved and instance overrides are applied without mutating the library object.

Runtime target classification prefers PF2e Actor relationship helpers (`isAllyOf` / `isEnemyOf`) and uses Actor traits for required/excluded trait filtering. Spatial membership prefers PF2e Token placeable `distanceTo()`, which is also used by the PF2e system as the initial native-aura range test.

## Presence bindings

Presence Effects are desired-state mechanics, not historical enter events. For every emitter/presence/target-Actor combination the runtime derives a stable binding key:

```text
scene + source token + aura instance + presence effect + target Actor UUID
```

Effect Forge creates the actual PF2e Effect Item(s). Before that public API call, Aura Forge embeds its `auraPresenceBinding` in the Effect Definition `metadata`. Critical Forge persists the complete source definition in its own managed flags, so Aura Forge can reconstruct runtime state from Actor documents after reload and clean up the exact bound effect without a second post-create Item update. Legacy direct Aura Forge `presenceBinding` flags remain readable for cleanup.

If the embedded Effect Definition changes, its fingerprint changes. The stale bound effect bundle is removed and recreated from the new definition. Presence global duration is forced to unlimited; aura membership controls lifetime.

Instant Effect Engine components (`damage`, `death`) are invalid inside Presence Effects. Presence is reconstructed repeatedly from desired scene state, so replaying one-shot mechanics there would be unsafe. Validation rejects that authoring shape and the Presence application path additionally sets `executeInstant: false` as a runtime guard.

## Enter / Leave transitions

The engine keeps in-memory occupancy per scene/source-token/instance. Initial scene reconciliation seeds occupancy and therefore does not synthesize `enter` effects for creatures already inside after a reload. Subsequent movement reconciliations compare previous and current occupancy and execute `enter`/`leave` trigger effects.

A trigger without a saving throw uses its `success` outcome as the direct event effect. Trigger outcomes are the Aura Forge one-shot boundary: the exact target Token is passed to Critical Forge `effects.apply()` with `executeInstant: true`. Persistent components create their normal PF2e Effect Items, while instant `damage` and `death` components execute once for the already-claimed aura occurrence. Passing the Token rather than only its Actor preserves token-specific damage application when the same Actor has multiple active tokens. Save-enabled event triggers resolve through the native PF2e saving-throw statistic and dispatch the matching degree-of-success outcome. A closed interactive dialog, missing remote response, or request timeout is not treated as consent to skip a mandatory save: the target Actor's runtime writer performs one native no-dialog fallback roll and uses that degree. Transition and turn side effects are owned by the target Actor's single mutation authority: PF2e `primaryUpdater` when available, with Aura Forge's deterministic coordinator as a fallback only when PF2e cannot provide one. In `request` mode that owner sends a module-socket request to an active non-GM user assigned to or owning the target Actor when possible; the player returns the resolved degree/status and the owning client applies the matching Effect Forge outcome exactly once. `automatic` and GM-request modes prefer the selected active GM. Vanishing/disabled emitters clean Presence Effects but do not synthesize a `leave` event. Turn-bound triggers use Foundry v14 combat turn history: the prior combatant receives `turnEnd` processing and the new combatant receives `turnStart` processing, with event claims keyed by stable token/combatant identity so initiative reordering does not replay an already-processed turn. Temporary immunity is persisted as a managed PF2e Effect Item. Its scope key can bind to one aura instance, one source, or one ability key; matching immunity blocks future event occurrences from that aura while it remains active. Immunity granted by one trigger does not retroactively cancel sibling triggers in the same already-started event.

### Event / Presence ordering contract

Discrete events always finish before continuous Presence state is reconciled:

```text
event → save → degree outcome → immunity mutation → Presence reconciliation
```

If a trigger grants immunity with `blocksPresence: true`, an already active Presence Effect is removed immediately after that event. If the immunity is granted on `enter`, Presence is never created in the first place. When the immunity expires or its managed PF2e Effect Item is removed while the target remains inside the aura, Presence is recalculated and restored automatically. `blocksPresence: false` keeps the older event-only immunity semantics.

## Multi-client ownership

Automatic Actor aura proxy reconciliation follows the same single-writer principle as runtime effects. All clients may observe `ready` or Aura Library changes, but only the Actor's PF2e `primaryUpdater` (or a deterministic active owner/GM fallback) creates, updates, or deletes its managed proxy. Proxy reconciliation compares the desired source with the existing Item first, so an already-current proxy causes zero embedded Item writes.

Coordinate-bearing `updateToken` hooks are treated as transition-capable on every client. Each target Actor is nevertheless mutated by only one client, using PF2e `primaryUpdater` identity by stable User ID rather than object identity; this prevents duplicate effects while allowing player-owned/no-GM sessions to execute their own aura events. Player-request save dialogs are routed over the module socket and therefore do not depend on which client physically moved the token. Remote save reconstruction prefers token-scoped Actors over same-ID world Actors so unlinked/synthetic tokens keep token-specific prepared data. Before creating/removing runtime Effect Items, a narrow compatibility guard normalizes completely missing `system.description` objects on PF2e physical Items; this prevents an unrelated malformed legacy/custom item from crashing the full Actor reset triggered by an embedded-item mutation.

## Lifecycle

- `ready` / `canvasReady`: seed occupancy and reconstruct Presence Effects.
- `moveToken`: reconcile with enter/leave events.
- `updateToken`: reconcile non-event geometry/state changes.
- `createToken`: reconcile and permit an enter transition after the scene has been seeded.
- `deleteToken`: reconcile cleanup without synthetic leave.
- `updateActor`: reconcile active-scene relationship/instance changes without synthetic transitions.
- Managed temporary-immunity Item create/update/delete: refresh Presence state without changing occupancy.
- `updateWorldTime`: refresh Presence state so minute/hour/day fallback expiry can remove stale immunity and restore Presence without token movement.
- Aura Library setting updates: every client requests Actor-proxy reconciliation, the per-Actor writer performs any needed idempotent proxy sync, and the active scene reconciles current definitions without synthetic transitions.
- `canvasTearDown`: cancel queued/late reconciliation for the departing canvas, remove Presence Effects belonging to the scene, and clear occupancy state.
- `deleteCombat`: clear local combat history and runtime event claims so a later Combat run cannot inherit stale deduplication state.

## Embedded Effect Editor and Effect Engine

Aura Forge continues to use only the public PF2E Critical Forge API. The editor remains embedded UI; persistence and Aura workflow are owned by Aura Forge. Aura Forge 1.0.0-rc.2 requires Critical Forge 1.0.1-rc.3 / Effect API 0.9.6, the public contract that exposes both instant Damage and Death. Event outcomes use `effects.apply(..., { executeInstant: true })`; Presence uses the same API with `executeInstant: false`.

## Spatial boundary

Aura Forge currently evaluates membership from the source and target token positions at reconciliation time. It does not reconstruct the full movement path, so a token that starts outside, crosses the radius, and finishes outside before reconciliation does not generate synthetic `enter`/`leave` events. Native PF2e wall/sensory aura-square blocking is also outside the current runtime contract. These are explicit feature boundaries rather than accidental event semantics.
