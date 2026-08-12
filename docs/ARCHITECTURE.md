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
├── temporary-immunity lifecycle
├── desired Presence Effect reconciliation
└── Effect Forge public application API
```

Aura Definitions own targeting, presence effects, triggers, saves, temporary immunity policy, and Effect Forge payloads. Aura Instances do not copy those definitions. They reference `definitionId` and hold only Actor-specific state. A managed passive PF2e ability mirrors the aura name/description on the Actor sheet; it contains no runtime authority and is recreated from the instance/definition if missing.

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

## Enter / Leave transitions

The engine keeps in-memory occupancy per scene/source-token/instance. Initial scene reconciliation seeds occupancy and therefore does not synthesize `enter` effects for creatures already inside after a reload. Subsequent movement reconciliations compare previous and current occupancy and execute `enter`/`leave` trigger effects.

A trigger without a saving throw uses its `success` outcome as the direct event effect. Save-enabled event triggers resolve through the native PF2e saving-throw statistic and dispatch the matching degree-of-success outcome. One deterministic runtime coordinator detects transition side effects. In `request` mode it sends a module-socket request to an active non-GM user assigned to or owning the target Actor when possible; the player returns only the resolved degree/status and the coordinator applies the matching Effect Forge outcome exactly once. `automatic` and GM-request modes prefer the selected active GM. This routing is deliberately separate from PF2e `primaryUpdater`, which remains the authority for Actor document mutation. Vanishing/disabled emitters clean Presence Effects but do not synthesize a `leave` event. Turn-bound triggers use Foundry v14 combat turn history: the prior combatant receives `turnEnd` processing and the new combatant receives `turnStart` processing, with deduplication and rewind suppression. Temporary immunity is persisted as a managed PF2e Effect Item. Its scope key can bind to one aura instance, one source, or one ability key; matching immunity blocks all event triggers from that aura while it remains active.

### Event / Presence ordering contract

Discrete events always finish before continuous Presence state is reconciled:

```text
event → save → degree outcome → immunity mutation → Presence reconciliation
```

If a trigger grants immunity with `blocksPresence: true`, an already active Presence Effect is removed immediately after that event. If the immunity is granted on `enter`, Presence is never created in the first place. When the immunity expires or its managed PF2e Effect Item is removed while the target remains inside the aura, Presence is recalculated and restored automatically. `blocksPresence: false` keeps the older event-only immunity semantics.

## Multi-client ownership

Coordinate-bearing `updateToken` hooks are treated as transition-capable on every client, while only the deterministic runtime coordinator executes enter/leave side effects. The runtime still mutates a target Actor only when the current user is that PF2e Actor's `primaryUpdater`, preventing duplicate effect creation. Player-request save dialogs are routed over the module socket and therefore do not depend on which client physically moved the token. Before creating/removing runtime Effect Items, a narrow compatibility guard normalizes completely missing `system.description` objects on PF2e physical Items; this prevents an unrelated malformed legacy/custom item from crashing the full Actor reset triggered by an embedded-item mutation.

## Lifecycle

- `ready` / `canvasReady`: seed occupancy and reconstruct Presence Effects.
- `moveToken`: reconcile with enter/leave events.
- `updateToken`: reconcile non-event geometry/state changes.
- `createToken`: reconcile and permit an enter transition after the scene has been seeded.
- `deleteToken`: reconcile cleanup without synthetic leave.
- `updateActor`: reconcile active-scene relationship/instance changes without synthetic transitions.
- Managed temporary-immunity Item create/update/delete: refresh Presence state without changing occupancy.
- `updateWorldTime`: refresh Presence state so minute/hour/day fallback expiry can remove stale immunity and restore Presence without token movement.
- Aura Library setting updates: reconcile current definitions without synthetic transitions.
- `canvasTearDown`: remove Presence Effects belonging to the scene and clear occupancy state.

## Embedded Effect Editor and Effect Engine

Aura Forge continues to use only the public PF2E Critical Forge API. The editor remains embedded UI; persistence and Aura workflow are owned by Aura Forge. Runtime effect application uses the unchanged public `effects.apply()` API.
