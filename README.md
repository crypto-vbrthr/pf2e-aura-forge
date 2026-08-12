# PF2E Aura Forge

Aura Forge is the aura-definition and management layer for the Forge Suite. Version 0.1.1 contains the **Aura Core & Editor Foundation** milestone.

## Included in this milestone

- Stable Aura Definition schema (`schemaVersion: 1`).
- Separate `presenceEffects` for effects that exist continuously while a target is inside an aura.
- Event `triggers` for `enter`, `leave`, `turnStart`, and `turnEnd`.
- Optional saving-throw configuration per trigger.
- Four PF2e degrees of success per trigger.
- Trigger-owned temporary immunity definitions with `instance`, `source`, and `ability` scope.
- World-scoped Aura Library with create, edit, duplicate, and delete workflows.
- Direct use of the **PF2E Critical Forge Embedded Effect Editor** for every presence effect and trigger outcome.
- The embedded editor opens inline at the aura entry being edited; Aura Forge action re-renders preserve scroll position.
- Aura Forge owns Save/Duplicate/Delete. The embedded Effect Editor owns effect composition only.
- Pure presence reconciliation planning that can reconstruct missing bindings from current aura state. No combat or token hooks are activated yet.

## Dependency

This milestone requires **PF2E Critical Forge 1.0.0-rc.1 or newer** and feature-detects the public embedded editor API under:

```js
const criticalApi = game.modules.get("pf2e-critical-forge")?.api;
criticalApi.ui.effectEditor.createSession(...);
criticalApi.ui.effectEditor.create(...);
```

Aura Forge does not import Critical Forge internals and does not modify the existing `api.effects` contract.

## Opening Aura Forge

For GMs, Aura Forge adds an **Aura Forge** button to the Items sidebar header. It is also available through:

```js
game.modules.get("pf2e-aura-forge")?.api.ui.openAuraForge();
```

## Public API

```js
const api = game.modules.get("pf2e-aura-forge")?.api;

const aura = api.definitions.create({ name: "Aura of Dread", radius: 30 });
const report = api.definitions.validate(aura);
await api.library.upsert(aura);
```

The runtime Aura Engine is deliberately not connected to Foundry hooks in this milestone. `api.engine.planPresence(...)` exposes only the pure reconciliation planner used by later runtime work.
