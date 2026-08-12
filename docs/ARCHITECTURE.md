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

Aura Engine Core
└── later resolves Actor instances into active runtime auras
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

## Resolution

Resolving an instance clones its current Aura Definition, applies supported instance overrides, and combines definition/instance enabled state. The library object is never mutated.

## Referential integrity

Deleting an Aura Definition also removes references to that definition from world Actors and removes the matching managed ability proxies. Duplication creates a new definition but never copies Actor assignments. On world ready, reconciliation upgrades legacy flag-only assignments and removes orphaned managed proxies.

## Embedded Effect Editor

Aura Forge continues to use only the public PF2E Critical Forge editor API. Actor assignment is Aura Forge container logic and does not alter the Effect Forge API contract.
