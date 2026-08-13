import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuraEditorSession,
  createAuraEditorUiApi
} from "../scripts/ui/aura-editor.js";
import {
  createAuraDefinition,
  createAuraTrigger,
  createPresenceEffect
} from "../scripts/aura/aura-definition.js";

test("AuraEditorSession round-trips the complete AuraDefinition without owning persistence", () => {
  const source = createAuraDefinition({
    name: "Withering Presence",
    radius: 20,
    metadata: { custom: { keep: true } },
    presenceEffects: [createPresenceEffect({
      name: "Armor penalty",
      effect: { id: "effect.presence", name: "Penalty", components: [{ type: "modifier", selector: "ac", value: -1 }] }
    })],
    triggers: [createAuraTrigger({
      name: "Enter save",
      event: "enter",
      save: { enabled: true, type: "fortitude", mode: "request", dc: { mode: "fixed", value: 25 } },
      outcomes: { failure: { id: "effect.fail", name: "Failure", components: [] } }
    })]
  });

  const session = createAuraEditorSession(source, { context: { usage: "creature-forge" } });
  assert.deepEqual(session.buildDefinition(), source);
  assert.equal(session.context.usage, "creature-forge");
  assert.equal(session.dirty, false);

  session.state.radius = 30;
  session.refreshDirty();
  assert.equal(session.dirty, true);
  assert.equal(session.buildDefinition().radius, 30);
  assert.deepEqual(session.buildDefinition().metadata.custom, { keep: true });
});

test("public Aura Editor UI API is additive and exposes session/component factories", () => {
  const api = createAuraEditorUiApi();
  assert.equal(typeof api.template, "string");
  assert.equal(typeof api.createSession, "function");
  assert.equal(typeof api.create, "function");
  assert.equal(typeof api.render, "function");
  assert.equal(typeof api.prepareContext, "function");

  const session = api.createSession(createAuraDefinition({ name: "Embedded" }), {
    context: { usage: "creature-forge" }
  });
  const editor = api.create({ session, context: { usage: "creature-forge" } });
  assert.equal(editor.session, session);
  assert.equal(editor.value.name, "Embedded");
});
