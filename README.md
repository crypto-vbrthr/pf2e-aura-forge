# PF2E Aura Forge

Aura Forge is the aura-definition and management layer for the Forge Suite. Version 0.2.1 polishes **Actor Assignment & Aura Instances** with Actor Directory drag-and-drop and sheet-visible PF2e passive abilities.

## Included

- Stable Aura Definition schema (`schemaVersion: 1`).
- Separate `presenceEffects` and discrete event `triggers`.
- Embedded PF2E Critical Forge Effect Editor for all effect payloads.
- World-scoped Aura Library with create, edit, duplicate, and delete workflows.
- Actor-scoped Aura Instances stored as module flags on Actor documents.
- Assign a saved aura to a world Actor from Aura Forge, including direct drag-and-drop from the Actor Directory.
- Every assignment has a managed PF2e passive ability proxy on the Actor so the aura is visible in the Actor abilities list.
- One-click assignment to exactly one selected token when it represents a world Actor.
- Per-instance enable/disable state.
- Optional per-instance radius override without copying or mutating the central Aura Definition.
- Remove an assignment without deleting the Aura Definition.
- Deleting an Aura Definition removes its Actor references to avoid orphaned assignments.
- Additive public `api.instances` contract for other Forge modules, including reconciliation and definition-sync helpers.
- Pure presence reconciliation planning remains available for the later runtime engine.

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

## Public API

```js
const api = game.modules.get("pf2e-aura-forge")?.api;
const actor = game.actors.get("ACTOR_ID");
const aura = await api.library.get("AURA_ID");

const instance = await api.instances.assign(actor, aura.id);
await api.instances.setEnabled(actor, instance.id, false);
await api.instances.setRadiusOverride(actor, instance.id, 20);
const report = await api.instances.resolve(actor, instance.id);
await api.instances.reconcileActor(actor);
```

The runtime Aura Engine is still deliberately not connected to movement or combat hooks in this milestone.
