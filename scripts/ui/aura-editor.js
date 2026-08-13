import {
  AURA_TRIGGER_EVENTS,
  DEGREE_KEYS,
  IMMUNITY_SCOPES,
  MODULE_ID,
  SAVE_MODES,
  SAVE_TYPES
} from "../constants.js";
import {
  cloneAuraDefinition,
  createAuraDefinition,
  createAuraTrigger,
  createPresenceEffect
} from "../aura/aura-definition.js";
import { validateAuraDefinition } from "../aura/aura-validator.js";
import {
  assertEffectForgeApi,
  createDefaultEmbeddedEffect,
  getEffectForgeApi
} from "../integration/effect-forge-bridge.js";

export const AURA_EDITOR_TEMPLATE = `modules/${MODULE_ID}/templates/aura-editor.hbs`;

function clone(value) {
  if (value == null) return value;
  const deepClone = globalThis.foundry?.utils?.deepClone;
  return typeof deepClone === "function" ? deepClone(value) : structuredClone(value);
}

function effectSummary(effect) {
  if (!effect) return { hasEffect: false, effectName: "", componentCount: 0 };
  return {
    hasEffect: true,
    effectName: String(effect.name ?? ""),
    componentCount: Array.isArray(effect.components) ? effect.components.length : 0
  };
}

function optionList(values, selected, prefix) {
  return values.map((value) => ({
    value,
    selected: value === selected,
    label: game.i18n.localize(`${prefix}.${value}`)
  }));
}

function degreeLabel(degree) {
  return game.i18n.localize(`PF2E_AURA_FORGE.Degrees.${degree}`);
}

function slugify(value) {
  return String(value ?? "effect")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "effect";
}

export function syncTriggerDraftFromCard(trigger, card) {
  if (!trigger || !card?.querySelector) return trigger;
  trigger.name = card.querySelector('[name="triggerName"]')?.value ?? trigger.name;
  trigger.event = card.querySelector('[name="triggerEvent"]')?.value ?? trigger.event;
  trigger.save.enabled = Boolean(card.querySelector('[name="saveEnabled"]')?.checked);
  trigger.save.type = card.querySelector('[name="saveType"]')?.value ?? trigger.save.type;
  trigger.save.mode = card.querySelector('[name="saveMode"]')?.value ?? trigger.save.mode;
  trigger.save.dc.mode = "fixed";
  trigger.save.dc.value = Number(card.querySelector('[name="saveDc"]')?.value ?? trigger.save.dc.value);
  trigger.immunity.enabled = Boolean(card.querySelector('[name="immunityEnabled"]')?.checked);
  trigger.immunity.duration.value = Number(card.querySelector('[name="immunityValue"]')?.value ?? trigger.immunity.duration.value);
  trigger.immunity.duration.unit = card.querySelector('[name="immunityUnit"]')?.value ?? trigger.immunity.duration.unit;
  trigger.immunity.scope = card.querySelector('[name="immunityScope"]')?.value ?? trigger.immunity.scope;
  trigger.immunity.blocksPresence = Boolean(card.querySelector('[name="immunityBlocksPresence"]')?.checked);
  trigger.immunity.applyOn = [...(card.querySelectorAll?.('[data-immunity-degree]:checked') ?? [])]
    .map((input) => input.dataset.immunityDegree)
    .filter(Boolean);
  return trigger;
}

export class AuraEditorSession {
  constructor(definition = null, options = {}) {
    this.context = clone(options.context ?? {});
    this.state = createAuraDefinition(definition ? clone(definition) : clone(options.initial ?? {}));
    this.validation = options.validation ?? null;
    this.cleanSnapshot = "";
    this.dirty = false;
    this.markClean();
  }

  loadDefinition(definition, { context = this.context, markClean = true } = {}) {
    this.context = clone(context ?? {});
    this.state = createAuraDefinition(clone(definition ?? {}));
    this.validation = null;
    if (markClean) this.markClean();
    else this.refreshDirty();
    return this;
  }

  reset(options = {}) {
    return this.loadDefinition(createAuraDefinition(options.definition ?? {}), {
      context: options.context ?? this.context,
      markClean: options.markClean !== false
    });
  }

  snapshot() {
    return JSON.stringify(this.state);
  }

  markClean() {
    this.cleanSnapshot = this.snapshot();
    this.dirty = false;
    return this;
  }

  markDirty() {
    this.dirty = true;
    this.validation = null;
    return this;
  }

  refreshDirty() {
    this.dirty = this.snapshot() !== this.cleanSnapshot;
    this.validation = null;
    return this.dirty;
  }

  syncFromForm(root) {
    if (!(root instanceof HTMLElement)) return this.state;
    const q = (selector) => root.querySelector(selector);

    this.state.name = q('[name="auraName"]')?.value ?? this.state.name;
    this.state.description = q('[name="auraDescription"]')?.value ?? this.state.description;
    this.state.radius = Number(q('[name="auraRadius"]')?.value ?? this.state.radius);
    this.state.abilityId = q('[name="auraAbilityId"]')?.value ?? this.state.abilityId;
    this.state.enabled = Boolean(q('[name="auraEnabled"]')?.checked);

    for (const key of ["allies", "enemies", "neutral", "source"]) {
      this.state.targeting[key] = Boolean(q(`[name="target-${key}"]`)?.checked);
    }
    this.state.targeting.requiredTraits = String(q('[name="requiredTraits"]')?.value ?? "")
      .split(",").map((entry) => entry.trim()).filter(Boolean);
    this.state.targeting.excludedTraits = String(q('[name="excludedTraits"]')?.value ?? "")
      .split(",").map((entry) => entry.trim()).filter(Boolean);

    for (const row of root.querySelectorAll("[data-presence-id]")) {
      const entry = this.state.presenceEffects.find((item) => item.id === row.dataset.presenceId);
      if (!entry) continue;
      entry.name = row.querySelector('[name="presenceName"]')?.value ?? entry.name;
    }

    // Only actual trigger cards participate. Nested action buttons also carry
    // data-trigger-id for action routing and must never reset checkbox state.
    for (const card of root.querySelectorAll(".trigger-card[data-trigger-id]")) {
      const trigger = this.state.triggers.find((item) => item.id === card.dataset.triggerId);
      if (!trigger) continue;
      syncTriggerDraftFromCard(trigger, card);
    }

    this.refreshDirty();
    return this.state;
  }

  buildDefinition() {
    return cloneAuraDefinition(this.state);
  }

  validate({ effectApi = getEffectForgeApi()?.effects ?? null } = {}) {
    this.validation = validateAuraDefinition(this.state, { effectApi });
    return this.validation;
  }
}

export function createAuraEditorSession(definition = null, options = {}) {
  return new AuraEditorSession(definition, options);
}

export async function prepareAuraEditorContext(session, {
  validation = session?.validation ?? null,
  layout = "full"
} = {}) {
  if (!(session instanceof AuraEditorSession)) {
    throw new TypeError("Aura Editor requires an AuraEditorSession.");
  }

  const draft = session.state;
  const activeEffectRef = session.ui?.activeEffectRef ?? null;
  const presenceEffects = draft.presenceEffects.map((entry) => ({
    ...entry,
    ...effectSummary(entry.effect),
    isEditing: activeEffectRef === `presence:${entry.id}`
  }));

  const hasPresenceEffects = draft.presenceEffects.length > 0;
  const triggers = draft.triggers.map((trigger) => ({
    ...trigger,
    hasPresenceEffects,
    presenceInteractionHint: hasPresenceEffects && trigger.immunity.enabled && trigger.immunity.blocksPresence,
    eventOptions: optionList(AURA_TRIGGER_EVENTS, trigger.event, "PF2E_AURA_FORGE.TriggerEvents"),
    saveTypeOptions: optionList(SAVE_TYPES, trigger.save.type, "PF2E_AURA_FORGE.SaveTypes"),
    saveModeOptions: optionList(SAVE_MODES, trigger.save.mode, "PF2E_AURA_FORGE.SaveModes"),
    immunityScopeOptions: optionList(IMMUNITY_SCOPES, trigger.immunity.scope, "PF2E_AURA_FORGE.ImmunityScopes"),
    applyOn: DEGREE_KEYS.map((degree) => ({
      degree,
      label: degreeLabel(degree),
      checked: trigger.immunity.applyOn.includes(degree)
    })),
    outcomes: DEGREE_KEYS.map((degree) => ({
      degree,
      label: degreeLabel(degree),
      ...effectSummary(trigger.outcomes[degree]),
      isEditing: activeEffectRef === `trigger:${trigger.id}:${degree}`
    }))
  }));

  return {
    draft,
    presenceEffects,
    triggers,
    validation,
    hasValidationErrors: (validation?.errors?.length ?? 0) > 0,
    hasValidationWarnings: (validation?.warnings?.length ?? 0) > 0,
    auraEditorLayout: layout,
    editorContext: session.context ?? {}
  };
}

export async function renderAuraEditor(context, {
  renderTemplateFn = globalThis.foundry?.applications?.handlebars?.renderTemplate
} = {}) {
  if (typeof renderTemplateFn !== "function") {
    throw new Error("Foundry renderTemplate is unavailable.");
  }
  return renderTemplateFn(AURA_EDITOR_TEMPLATE, context);
}

export class EmbeddedAuraEditor {
  constructor({
    definition = null,
    session = null,
    effectApiProvider = getEffectForgeApi,
    layout = "full",
    context = null,
    onChange = null,
    onValidationChange = null
  } = {}) {
    this.session = session ?? createAuraEditorSession(definition, { context: context ?? {} });
    if (!this.session.ui) this.session.ui = { activeEffectRef: null };
    if (context) this.session.context = clone(context);
    this.effectApiProvider = effectApiProvider;
    this.layout = layout;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.onValidationChange = typeof onValidationChange === "function" ? onValidationChange : null;
    this.container = null;
    this.root = null;
    this.effectEditor = null;
    this.boundClick = null;
    this.boundInput = null;
    this.boundChange = null;
  }

  get value() {
    return this.session.buildDefinition();
  }

  get dirty() {
    return this.session.dirty;
  }

  get activeEffectRef() {
    return this.session.ui?.activeEffectRef ?? null;
  }

  set activeEffectRef(value) {
    if (!this.session.ui) this.session.ui = {};
    this.session.ui.activeEffectRef = value || null;
  }

  async renderHtml(options = {}) {
    const context = await prepareAuraEditorContext(this.session, {
      validation: options.validation ?? this.session.validation,
      layout: options.layout ?? this.layout
    });
    return renderAuraEditor(context, options);
  }

  async mount(container, options = {}) {
    if (!(container instanceof HTMLElement)) {
      throw new TypeError("Aura Editor mount target must be an HTMLElement.");
    }
    this.unmount({ clearContainer: false, preserveEffectRef: true });
    this.container = container;
    const html = await this.renderHtml(options);
    container.innerHTML = `<div class="aura-editor-embedded pf2e-aura-forge" data-aura-editor-root data-aura-editor-layout="${options.layout ?? this.layout}">${html}</div>`;
    this.root = container.querySelector("[data-aura-editor-root]");
    this.#bind();
    this.#toggleConditionalControls();
    await this.#mountEffectEditor();
    return this;
  }

  unmount({ clearContainer = false, preserveEffectRef = true } = {}) {
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    if (this.root && this.boundClick) this.root.removeEventListener("click", this.boundClick);
    if (this.root && this.boundInput) this.root.removeEventListener("input", this.boundInput);
    if (this.root && this.boundChange) this.root.removeEventListener("change", this.boundChange);
    if (clearContainer && this.container instanceof HTMLElement) this.container.replaceChildren();
    this.root = null;
    this.boundClick = null;
    this.boundInput = null;
    this.boundChange = null;
    if (!preserveEffectRef) this.activeEffectRef = null;
  }

  resetUiState() {
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    this.activeEffectRef = null;
    return this;
  }

  sync() {
    if (this.root instanceof HTMLElement) this.session.syncFromForm(this.root);
    return this.value;
  }

  validate(options = {}) {
    this.sync();
    const report = this.session.validate({
      effectApi: options.effectApi ?? this.effectApiProvider?.()?.effects ?? null
    });
    this.onValidationChange?.(report, this.session);
    return report;
  }

  async rerender(options = {}) {
    if (!this.container) return this;
    return this.mount(this.container, options);
  }

  #effectApi() {
    return assertEffectForgeApi(this.effectApiProvider?.());
  }

  #bind() {
    if (!(this.root instanceof HTMLElement)) return;
    this.boundClick = async (event) => {
      const target = event.target?.closest?.("[data-action]");
      if (!target || !this.root.contains(target)) return;
      const action = target.dataset.action;
      if (!this.#isEditorAction(action)) return;
      event.preventDefault();
      event.stopPropagation();
      await this.#handleAction(action, target);
    };
    const sync = (event) => {
      if (event?.target?.closest?.("[data-embedded-effect-panel]")) return;
      this.session.syncFromForm(this.root);
      this.#toggleConditionalControls();
      this.onChange?.(this.session, { type: "field", event });
    };
    this.boundInput = sync;
    this.boundChange = sync;
    this.root.addEventListener("click", this.boundClick);
    this.root.addEventListener("input", this.boundInput);
    this.root.addEventListener("change", this.boundChange);
  }

  #isEditorAction(action) {
    return new Set([
      "addPresenceEffect", "removePresenceEffect", "editPresenceEffect",
      "addTrigger", "removeTrigger", "editOutcomeEffect", "clearOutcomeEffect",
      "closeEmbeddedEditor"
    ]).has(action);
  }

  #syncBeforeAction() {
    if (this.root instanceof HTMLElement) this.session.syncFromForm(this.root);
  }

  async #changed({ rerender = true, type = "structure" } = {}) {
    this.session.refreshDirty();
    this.onChange?.(this.session, { type });
    if (rerender) await this.rerender();
  }

  async #handleAction(action, target) {
    this.#syncBeforeAction();

    if (action === "addPresenceEffect") {
      const entry = createPresenceEffect({ name: game.i18n.localize("PF2E_AURA_FORGE.NewPresenceEffect") });
      this.session.state.presenceEffects.push(entry);
      this.activeEffectRef = `presence:${entry.id}`;
      await this.#changed();
      return;
    }

    if (action === "removePresenceEffect") {
      const id = target.dataset.presenceId;
      this.session.state.presenceEffects = this.session.state.presenceEffects.filter((entry) => entry.id !== id);
      if (this.activeEffectRef === `presence:${id}`) this.activeEffectRef = null;
      await this.#changed();
      return;
    }

    if (action === "editPresenceEffect") {
      const ref = `presence:${target.dataset.presenceId}`;
      this.activeEffectRef = this.activeEffectRef === ref ? null : ref;
      await this.rerender();
      return;
    }

    if (action === "addTrigger") {
      this.session.state.triggers.push(createAuraTrigger({ name: game.i18n.localize("PF2E_AURA_FORGE.NewTrigger") }));
      await this.#changed();
      return;
    }

    if (action === "removeTrigger") {
      const id = target.dataset.triggerId;
      this.session.state.triggers = this.session.state.triggers.filter((entry) => entry.id !== id);
      if (this.activeEffectRef?.startsWith(`trigger:${id}:`)) this.activeEffectRef = null;
      await this.#changed();
      return;
    }

    if (action === "editOutcomeEffect") {
      const degree = target.dataset.degree;
      if (!DEGREE_KEYS.includes(degree)) return;
      const ref = `trigger:${target.dataset.triggerId}:${degree}`;
      this.activeEffectRef = this.activeEffectRef === ref ? null : ref;
      await this.rerender();
      return;
    }

    if (action === "clearOutcomeEffect") {
      const trigger = this.session.state.triggers.find((entry) => entry.id === target.dataset.triggerId);
      const degree = target.dataset.degree;
      if (!trigger || !DEGREE_KEYS.includes(degree)) return;
      trigger.outcomes[degree] = null;
      if (this.activeEffectRef === `trigger:${trigger.id}:${degree}`) this.activeEffectRef = null;
      await this.#changed();
      return;
    }

    if (action === "closeEmbeddedEditor") {
      this.activeEffectRef = null;
      await this.rerender();
    }
  }

  #toggleConditionalControls() {
    if (!(this.root instanceof HTMLElement)) return;
    for (const card of this.root.querySelectorAll(".trigger-card[data-trigger-id]")) {
      const saveEnabled = Boolean(card.querySelector('[name="saveEnabled"]')?.checked);
      const saveConfig = card.querySelector("[data-save-config]");
      if (saveConfig) saveConfig.hidden = !saveEnabled;
      const immunityEnabled = Boolean(card.querySelector('[name="immunityEnabled"]')?.checked);
      const immunityConfig = card.querySelector("[data-immunity-config]");
      if (immunityConfig) immunityConfig.hidden = !immunityEnabled;
      const blocksPresence = Boolean(card.querySelector('[name="immunityBlocksPresence"]')?.checked);
      const presenceHint = card.querySelector("[data-immunity-presence-hint]");
      if (presenceHint) presenceHint.hidden = !(immunityEnabled && blocksPresence);
    }
  }

  #resolveEffectRef(ref = this.activeEffectRef) {
    if (!ref) return null;
    const [kind, first, second] = ref.split(":");
    if (kind === "presence") {
      const entry = this.session.state.presenceEffects.find((item) => item.id === first);
      if (!entry) return null;
      return {
        get: () => entry.effect,
        set: (value) => { entry.effect = clone(value); },
        label: entry.name || game.i18n.localize("PF2E_AURA_FORGE.PresenceEffect"),
        stableId: `pf2e-aura-forge.${slugify(this.session.state.id)}.${slugify(entry.id)}`
      };
    }
    if (kind === "trigger" && DEGREE_KEYS.includes(second)) {
      const trigger = this.session.state.triggers.find((item) => item.id === first);
      if (!trigger) return null;
      return {
        get: () => trigger.outcomes[second],
        set: (value) => { trigger.outcomes[second] = clone(value); },
        label: `${trigger.name || game.i18n.localize("PF2E_AURA_FORGE.Trigger")} – ${degreeLabel(second)}`,
        stableId: `pf2e-aura-forge.${slugify(this.session.state.id)}.${slugify(trigger.id)}.${second}`
      };
    }
    return null;
  }

  async #mountEffectEditor() {
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    if (!this.activeEffectRef || !(this.root instanceof HTMLElement)) return;
    const host = this.root.querySelector("[data-embedded-effect-editor]");
    if (!(host instanceof HTMLElement)) return;

    const api = this.#effectApi();
    const slot = this.#resolveEffectRef();
    if (!slot) return;
    let definition = slot.get();
    if (!definition) {
      definition = createDefaultEmbeddedEffect(api, {
        id: slot.stableId,
        name: slot.label,
        duration: { value: -1, unit: "unlimited", expiry: null }
      });
      slot.set(definition);
      this.session.refreshDirty();
      this.onChange?.(this.session, { type: "effect-created", ref: this.activeEffectRef });
    }

    const effectSession = api.ui.effectEditor.createSession(definition);
    this.effectEditor = api.ui.effectEditor.create({
      session: effectSession,
      layout: "full",
      onChange: () => {
        try {
          slot.set(this.effectEditor.value);
          this.session.refreshDirty();
          this.onChange?.(this.session, { type: "effect", ref: this.activeEffectRef });
        } catch (error) {
          console.warn(`${MODULE_ID} | Embedded effect draft could not be normalized yet.`, error);
        }
      }
    });
    await this.effectEditor.mount(host, { layout: "full" });
  }
}

export function createEmbeddedAuraEditor(options = {}) {
  return new EmbeddedAuraEditor(options);
}

export function createAuraEditorUiApi() {
  return Object.freeze({
    template: AURA_EDITOR_TEMPLATE,
    createSession: (definition = null, options = {}) => createAuraEditorSession(definition, options),
    create: (options = {}) => createEmbeddedAuraEditor(options),
    render: (context, options = {}) => renderAuraEditor(context, options),
    prepareContext: (session, options = {}) => prepareAuraEditorContext(session, options)
  });
}
