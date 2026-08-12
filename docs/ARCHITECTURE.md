# Aura Forge Architecture

## Core separation

```text
Aura Forge container
├── Aura definition + library workflow
├── Presence effects
├── Event triggers / saves / temporary immunity
└── Embedded Effect Editor (from PF2E Critical Forge)

Aura Engine Core
└── Pure presence reconciliation planning
```

`presenceEffects` are stateful relationships, not synthetic `enter` + `leave` trigger pairs. A runtime engine can therefore reconstruct them after reloads, radius changes, activation changes, or token teleports by comparing desired bindings with active bindings.

`triggers` describe discrete events. A trigger owns save and temporary-immunity policy. Its four outcome payloads are Effect Definitions owned and edited by Effect Forge.

## Embedded Effect Editor contract

Aura Forge uses only the public Critical Forge API:

```js
api.ui.effectEditor.createSession(definition)
api.ui.effectEditor.create({ session, onChange })
await editor.mount(container)
editor.value
editor.unmount()
```

The Aura Forge container owns Save/Duplicate/Delete/Close. The embedded editor never persists or applies an aura by itself.

## Runtime boundary

Version 0.1.0 does **not** hook token movement or combat turns. The pure `planPresenceReconciliation` contract is included so runtime work can be added without changing the schema or UI semantics.
