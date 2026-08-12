# Changelog

## 0.1.3 - Embedded Effect Forge Theme

- Embedded Effect Editor panels now use the Critical/Effect Forge theme scope and panel classes directly.
- Effect component colors, colored component borders, field styling, buttons, focus states, and panel chrome now match the standalone Effect Forge.
- Aura Forge retains only layout overrides for the embedded editor, avoiding a second copied visual theme that could drift from Effect Forge.
- Added regression coverage to ensure both presence-effect and trigger-outcome editors stay inside the shared Effect Forge theme scope.

## 0.1.2 - Editor Workspace Size

- Increased the default Aura Forge window from 1240×840 to 1500×960 so the Embedded Effect Editor has substantially more working space.
- Automatically upgrades the former 1240×840 default window state while preserving genuinely custom user window sizes.
- Added window-state regression tests for default-size migration and custom-size preservation.

## 0.1.1 - Editor & Scroll Fix

- Fixed Aura Forge action re-renders resetting the main and library scroll positions.
- Moved the Embedded Effect Editor inline to the presence effect or trigger outcome being edited.
- Fixed the misleading "Edit Effect" behavior where the editor opened out of view at the bottom of the window.
- Added scroll-state regression tests and inline-editor architecture tests.

## 0.1.0 - Aura Core & Editor Foundation

- Added Aura Definition schema v1.
- Added separate continuous presence effects and discrete event triggers.
- Added saving throw and temporary immunity configuration.
- Added four PF2e degree-of-success outcome slots per trigger.
- Added world Aura Library with create/edit/duplicate/delete UI.
- Integrated the PF2E Critical Forge Embedded Effect Editor without importing Critical Forge internals.
- Added pure target filtering and presence reconciliation planning.
- Added unit, repository, migration, validation, integration-contract, and reconciliation tests.
