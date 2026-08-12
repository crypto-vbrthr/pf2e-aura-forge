import {
  AURA_TRIGGER_EVENTS,
  DEGREE_KEYS,
  IMMUNITY_SCOPES,
  MODULE_ID,
  SAVE_MODES,
  SAVE_TYPES,
  SETTINGS
} from "../constants.js";
import {
  cloneAuraDefinition,
  createAuraDefinition,
  createAuraTrigger,
  createPresenceEffect
} from "../aura/aura-definition.js";
import { validateAuraDefinition } from "../aura/aura-validator.js";
import { createFoundryAuraRepository } from "../aura/foundry-aura-repository.js";
import { ActorAuraService } from "../actor/actor-aura-service.js";
import {
  assertEffectForgeApi,
  createDefaultEmbeddedEffect,
  getEffectForgeApi
} from "../integration/effect-forge-bridge.js";
import { captureScrollState, restoreScrollState } from "./view-state.js";
import {
  AURA_FORGE_DEFAULT_WINDOW_SIZE,
  normalizeSavedWindowState,
  normalizeWindowState
} from "./window-state.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function clone(value) {
  return value == null ? value : foundry.utils.deepClone(value);
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
  trigger.immunity.applyOn = [...(card.querySelectorAll?.('[data-immunity-degree]:checked') ?? [])]
    .map((input) => input.dataset.immunityDegree)
    .filter(Boolean);
  return trigger;
}

function slugify(value) {
  return String(value ?? "effect")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "effect";
}

async function confirmDialog(titleKey, promptKey) {
  const title = game.i18n.localize(titleKey);
  const content = `<p>${game.i18n.localize(promptKey)}</p>`;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return Boolean(await DialogV2.confirm({ window: { title }, content, modal: true, rejectClose: false }));
  }
  return globalThis.confirm?.(game.i18n.localize(promptKey)) ?? false;
}

export class AuraForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf2e-aura-forge-app",
    classes: ["pf2e-aura-forge", "aura-forge-app"],
    tag: "form",
    window: {
      title: "PF2E_AURA_FORGE.WindowTitle",
      icon: "fa-solid fa-circle-nodes",
      resizable: true
    },
    position: { ...AURA_FORGE_DEFAULT_WINDOW_SIZE },
    actions: {
      newAura: AuraForgeApp.newAura,
      selectAura: AuraForgeApp.selectAura,
      saveAura: AuraForgeApp.saveAura,
      duplicateAura: AuraForgeApp.duplicateAura,
      deleteAura: AuraForgeApp.deleteAura,
      assignAura: AuraForgeApp.assignAura,
      assignSelectedToken: AuraForgeApp.assignSelectedToken,
      toggleActorAura: AuraForgeApp.toggleActorAura,
      removeActorAura: AuraForgeApp.removeActorAura,
      updateRadiusOverride: AuraForgeApp.updateRadiusOverride,
      addPresenceEffect: AuraForgeApp.addPresenceEffect,
      removePresenceEffect: AuraForgeApp.removePresenceEffect,
      editPresenceEffect: AuraForgeApp.editPresenceEffect,
      addTrigger: AuraForgeApp.addTrigger,
      removeTrigger: AuraForgeApp.removeTrigger,
      editOutcomeEffect: AuraForgeApp.editOutcomeEffect,
      clearOutcomeEffect: AuraForgeApp.clearOutcomeEffect,
      closeEmbeddedEditor: AuraForgeApp.closeEmbeddedEditor,
      closeWindow: AuraForgeApp.closeWindow
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/aura-forge-app.hbs` }
  };

  constructor(options = {}) {
    let savedPosition = {};
    try {
      savedPosition = normalizeSavedWindowState(game.settings?.get?.(MODULE_ID, SETTINGS.WINDOW_STATE) ?? {});
    } catch {
      savedPosition = {};
    }
    super(foundry.utils.mergeObject({ position: savedPosition }, options, { inplace: false }));
    this.repository = createFoundryAuraRepository();
    this.actorAuras = new ActorAuraService({ library: this.repository });
    this.auras = [];
    this.selectedAuraId = null;
    this.draft = createAuraDefinition();
    this.cleanSnapshot = JSON.stringify(this.draft);
    this.isDirty = false;
    this.validation = null;
    this.effectEditor = null;
    this.activeEffectRef = null;
    this.allowCloseWithoutPrompt = false;
    this.windowStateTimer = null;
    this.preservedScrollState = new Map();
    this.initialized = false;
  }

  async initialize() {
    this.auras = await this.repository.list();
    if (this.auras.length > 0) {
      this.selectedAuraId = this.auras[0].id;
      this.draft = cloneAuraDefinition(this.auras[0]);
    }
    this.#markClean();
    this.initialized = true;
    return this;
  }

  _onPosition(position) {
    super._onPosition(position);
    if (!this.initialized) return;
    globalThis.clearTimeout(this.windowStateTimer);
    this.windowStateTimer = globalThis.setTimeout(() => this.#persistWindowState(), 250);
  }

  async _prepareContext() {
    const effectApi = getEffectForgeApi();
    const compatibility = (() => {
      try {
        assertEffectForgeApi(effectApi);
        return { ready: true, version: effectApi.version ?? "—", schemaVersion: effectApi.schemaVersion ?? "—" };
      } catch (error) {
        return { ready: false, version: "—", schemaVersion: "—", error: error.message };
      }
    })();

    const draft = this.draft;
    const presenceEffects = draft.presenceEffects.map((entry) => ({
      ...entry,
      ...effectSummary(entry.effect),
      isEditing: this.activeEffectRef === `presence:${entry.id}`
    }));

    const triggers = draft.triggers.map((trigger) => ({
      ...trigger,
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
        isEditing: this.activeEffectRef === `trigger:${trigger.id}:${degree}`
      }))
    }));

    const actors = [...(game.actors?.contents ?? [])]
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
      .map((actor) => ({ id: actor.id, name: actor.name, type: actor.type }));
    const assignmentRows = this.selectedAuraId
      ? (await this.actorAuras.assignmentsForDefinition(this.selectedAuraId, game.actors?.contents ?? [])).map(({ actor, instance }) => ({
          actorId: actor.id,
          actorName: actor.name,
          actorType: actor.type,
          instanceId: instance.id,
          enabled: instance.enabled,
          radiusOverride: instance.overrides?.radius ?? ""
        }))
      : [];

    return {
      apiReady: compatibility.ready,
      effectApiVersion: compatibility.version,
      effectSchemaVersion: compatibility.schemaVersion,
      apiError: compatibility.error ?? "",
      auras: this.auras.map((aura) => ({
        id: aura.id,
        name: aura.name || game.i18n.localize("PF2E_AURA_FORGE.UntitledAura"),
        selected: aura.id === this.selectedAuraId
      })),
      hasAuras: this.auras.length > 0,
      draft,
      presenceEffects,
      triggers,
      isDirty: this.isDirty,
      validation: this.validation,
      hasValidationErrors: (this.validation?.errors?.length ?? 0) > 0,
      hasValidationWarnings: (this.validation?.warnings?.length ?? 0) > 0,
      activeEffectRef: this.activeEffectRef,
      selectedAuraId: this.selectedAuraId,
      hasActiveEffectEditor: Boolean(this.activeEffectRef),
      actors,
      hasActors: actors.length > 0,
      assignments: assignmentRows,
      hasAssignments: assignmentRows.length > 0,
      canAssign: Boolean(this.selectedAuraId && !this.isDirty)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;

    const auraFields = root.querySelector("[data-aura-fields]");
    const sync = (event) => {
      if (event?.target?.closest?.("[data-instance-controls]")) return;
      this.#syncDraftFromDom();
      this.#markDirty();
      this.#toggleConditionalControls(root);
    };
    auraFields?.addEventListener("input", sync);
    auraFields?.addEventListener("change", sync);
    this.#toggleConditionalControls(root);
    this.#setupActorDropZone(root);
    this.#mountEmbeddedEditor(root).catch((error) => {
      console.error(`${MODULE_ID} | Embedded Effect Editor mount failed.`, error);
      ui.notifications.error(game.i18n.localize("PF2E_AURA_FORGE.Notifications.EffectEditorFailed"));
    });
    this.#updateDirtyIndicator();
    this.#restoreScrollPositions();
  }

  #setupActorDropZone(root) {
    const zone = root.querySelector("[data-actor-drop-zone]");
    if (!(zone instanceof HTMLElement)) return;

    const clearDragState = () => zone.classList.remove("drag-over");
    zone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) clearDragState();
    });
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      clearDragState();
      try {
        const actor = await this.#actorFromDropEvent(event);
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.DropActorRequired"));
          return;
        }
        await this.#assignActor(actor);
      } catch (error) {
        console.error(`${MODULE_ID} | Actor drop assignment failed.`, error);
        ui.notifications.error(game.i18n.localize("PF2E_AURA_FORGE.Notifications.AssignmentFailed"));
      }
    });
  }

  async #actorFromDropEvent(event) {
    let data = null;
    try {
      data = globalThis.TextEditor?.getDragEventData?.(event) ?? null;
    } catch {
      data = null;
    }
    if (!data) {
      const raw = event.dataTransfer?.getData?.("text/plain") ?? "";
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    }
    if (!data) return null;

    let document = null;
    if (data.uuid && typeof globalThis.fromUuid === "function") {
      document = await globalThis.fromUuid(data.uuid);
    }
    document ??= data.id ? game.actors?.get?.(data.id) : null;
    if (!document || (document.documentName && document.documentName !== "Actor")) return null;

    // Aura instances intentionally live on world Actors so they follow the
    // character between scenes rather than being tied to a synthetic token.
    return game.actors?.get?.(document.id) ?? null;
  }

  async #assignActor(actor) {
    this.#syncDraftFromDom();
    this.#markDirty();
    if (!this.selectedAuraId || this.isDirty) {
      ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.SaveBeforeAssign"));
      return false;
    }
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.ActorRequired"));
      return false;
    }

    const existing = this.actorAuras.list(actor).some((x) => x.definitionId === this.selectedAuraId);
    if (existing) {
      // Calling assign again is intentional: it repairs legacy flag-only
      // assignments by ensuring the PF2e passive ability proxy exists.
      await this.actorAuras.assign(actor, this.selectedAuraId);
      ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.AlreadyAssigned"));
      await this.#renderPreservingScroll();
      return false;
    }

    await this.actorAuras.assign(actor, this.selectedAuraId);
    ui.notifications.info(game.i18n.format("PF2E_AURA_FORGE.Notifications.Assigned", { actor: actor.name }));
    await this.#renderPreservingScroll();
    return true;
  }

  async close(options = {}) {
    if (!this.allowCloseWithoutPrompt && this.isDirty) {
      const confirmed = await confirmDialog(
        "PF2E_AURA_FORGE.Dialogs.DiscardTitle",
        "PF2E_AURA_FORGE.Dialogs.DiscardPrompt"
      );
      if (!confirmed) return this;
    }
    this.allowCloseWithoutPrompt = false;
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    globalThis.clearTimeout(this.windowStateTimer);
    await this.#persistWindowState();
    return super.close(options);
  }

  #snapshot() {
    return JSON.stringify(this.draft);
  }

  #markClean() {
    this.cleanSnapshot = this.#snapshot();
    this.isDirty = false;
    this.#updateDirtyIndicator();
  }

  #markDirty() {
    this.isDirty = this.#snapshot() !== this.cleanSnapshot;
    this.validation = null;
    this.#updateDirtyIndicator();
  }

  #updateDirtyIndicator() {
    const indicator = this.element?.querySelector?.("[data-dirty-indicator]");
    if (!(indicator instanceof HTMLElement)) return;
    indicator.classList.toggle("dirty", this.isDirty);
    indicator.classList.toggle("clean", !this.isDirty);
    const text = indicator.querySelector("[data-dirty-text]");
    if (text) text.textContent = game.i18n.localize(
      this.isDirty ? "PF2E_AURA_FORGE.UnsavedChanges" : "PF2E_AURA_FORGE.AllChangesSaved"
    );
  }

  #syncDraftFromDom() {
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    const container = root.querySelector("[data-aura-fields]");
    if (!(container instanceof HTMLElement)) return;

    const q = (selector) => container.querySelector(selector);
    this.draft.name = q('[name="auraName"]')?.value ?? this.draft.name;
    this.draft.description = q('[name="auraDescription"]')?.value ?? this.draft.description;
    this.draft.radius = Number(q('[name="auraRadius"]')?.value ?? this.draft.radius);
    this.draft.abilityId = q('[name="auraAbilityId"]')?.value ?? this.draft.abilityId;
    this.draft.enabled = Boolean(q('[name="auraEnabled"]')?.checked);

    for (const key of ["allies", "enemies", "neutral", "source"]) {
      this.draft.targeting[key] = Boolean(q(`[name="target-${key}"]`)?.checked);
    }
    this.draft.targeting.requiredTraits = String(q('[name="requiredTraits"]')?.value ?? "")
      .split(",").map((entry) => entry.trim()).filter(Boolean);
    this.draft.targeting.excludedTraits = String(q('[name="excludedTraits"]')?.value ?? "")
      .split(",").map((entry) => entry.trim()).filter(Boolean);

    for (const row of container.querySelectorAll("[data-presence-id]")) {
      const entry = this.draft.presenceEffects.find((item) => item.id === row.dataset.presenceId);
      if (!entry) continue;
      entry.name = row.querySelector('[name="presenceName"]')?.value ?? entry.name;
    }

    // Only synchronize the trigger card itself. Nested action buttons also carry
    // data-trigger-id for action routing; treating those as cards would reset
    // checkbox-backed save/immunity configuration to false during Save.
    for (const card of container.querySelectorAll(".trigger-card[data-trigger-id]")) {
      const trigger = this.draft.triggers.find((item) => item.id === card.dataset.triggerId);
      if (!trigger) continue;
      syncTriggerDraftFromCard(trigger, card);
    }
  }

  #toggleConditionalControls(root) {
    for (const card of root.querySelectorAll("[data-trigger-id]")) {
      const saveEnabled = Boolean(card.querySelector('[name="saveEnabled"]')?.checked);
      const saveConfig = card.querySelector("[data-save-config]");
      if (saveConfig) saveConfig.hidden = !saveEnabled;
      const immunityEnabled = Boolean(card.querySelector('[name="immunityEnabled"]')?.checked);
      const immunityConfig = card.querySelector("[data-immunity-config]");
      if (immunityConfig) immunityConfig.hidden = !immunityEnabled;
    }
  }

  #resolveEffectRef(ref = this.activeEffectRef) {
    if (!ref) return null;
    const [kind, first, second] = ref.split(":");
    if (kind === "presence") {
      const entry = this.draft.presenceEffects.find((item) => item.id === first);
      if (!entry) return null;
      return {
        get: () => entry.effect,
        set: (value) => { entry.effect = clone(value); },
        label: entry.name || game.i18n.localize("PF2E_AURA_FORGE.PresenceEffect"),
        stableId: `pf2e-aura-forge.${slugify(this.draft.id)}.${slugify(entry.id)}`
      };
    }
    if (kind === "trigger" && DEGREE_KEYS.includes(second)) {
      const trigger = this.draft.triggers.find((item) => item.id === first);
      if (!trigger) return null;
      return {
        get: () => trigger.outcomes[second],
        set: (value) => { trigger.outcomes[second] = clone(value); },
        label: `${trigger.name || game.i18n.localize("PF2E_AURA_FORGE.Trigger")} – ${degreeLabel(second)}`,
        stableId: `pf2e-aura-forge.${slugify(this.draft.id)}.${slugify(trigger.id)}.${second}`
      };
    }
    return null;
  }

  async #mountEmbeddedEditor(root) {
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    if (!this.activeEffectRef) return;
    const host = root.querySelector("[data-embedded-effect-editor]");
    if (!(host instanceof HTMLElement)) return;

    const api = assertEffectForgeApi(getEffectForgeApi());
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
      this.#markDirty();
    }

    const session = api.ui.effectEditor.createSession(definition);
    this.effectEditor = api.ui.effectEditor.create({
      session,
      layout: "full",
      onChange: () => {
        try {
          slot.set(this.effectEditor.value);
          this.#markDirty();
        } catch (error) {
          console.warn(`${MODULE_ID} | Embedded effect draft could not be normalized yet.`, error);
        }
      }
    });
    await this.effectEditor.mount(host, { layout: "full" });
  }

  #captureScrollPositions() {
    const root = this.element;
    this.preservedScrollState = root instanceof HTMLElement
      ? captureScrollState(root)
      : new Map();
  }

  #restoreScrollPositions() {
    if (!(this.preservedScrollState instanceof Map) || this.preservedScrollState.size === 0) return;

    const state = this.preservedScrollState;
    this.preservedScrollState = new Map();

    const restore = () => {
      const root = this.element;
      if (root instanceof HTMLElement) restoreScrollState(root, state);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(restore);
    } else {
      globalThis.setTimeout(restore, 0);
    }
  }

  #renderPreservingScroll() {
    this.#captureScrollPositions();
    return this.render({ force: true });
  }

  #resetPreservedScroll() {
    this.preservedScrollState = new Map();
  }

  async #persistWindowState() {
    try {
      const position = this.position ?? {};
      await game.settings.set(MODULE_ID, SETTINGS.WINDOW_STATE, normalizeWindowState(position));
    } catch (error) {
      console.debug(`${MODULE_ID} | Window state persistence failed.`, error);
    }
  }

  async #loadAura(id) {
    const aura = this.auras.find((entry) => entry.id === id) ?? await this.repository.get(id);
    if (!aura) return false;
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    this.activeEffectRef = null;
    this.selectedAuraId = aura.id;
    this.draft = cloneAuraDefinition(aura);
    this.validation = null;
    this.#markClean();
    this.#resetPreservedScroll();
    await this.render({ force: true });
    return true;
  }

  async #confirmDiscardIfNeeded() {
    if (!this.isDirty) return true;
    return confirmDialog("PF2E_AURA_FORGE.Dialogs.DiscardTitle", "PF2E_AURA_FORGE.Dialogs.DiscardPrompt");
  }

  static async newAura() {
    if (!await this.#confirmDiscardIfNeeded()) return;
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    this.activeEffectRef = null;
    this.selectedAuraId = null;
    this.draft = createAuraDefinition();
    this.validation = null;
    this.#markClean();
    this.#resetPreservedScroll();
    await this.render({ force: true });
  }

  static async selectAura(_event, target) {
    const id = target.dataset.auraId;
    if (!id || id === this.selectedAuraId) return;
    this.#syncDraftFromDom();
    this.#markDirty();
    if (!await this.#confirmDiscardIfNeeded()) return;
    await this.#loadAura(id);
  }

  static async saveAura() {
    this.#syncDraftFromDom();
    if (this.effectEditor && this.activeEffectRef) {
      const slot = this.#resolveEffectRef();
      if (slot) slot.set(this.effectEditor.value);
    }
    const api = getEffectForgeApi();
    this.validation = validateAuraDefinition(this.draft, { effectApi: api?.effects ?? null });
    if (!this.validation.valid) {
      const details = this.validation.errors.slice(0, 5).map((entry) => `• ${entry.message}`).join("\n");
      ui.notifications.error(`${game.i18n.localize("PF2E_AURA_FORGE.Notifications.ValidationFailed")}\n${details}`);
      await this.#renderPreservingScroll();
      return;
    }

    const saved = await this.repository.upsert(this.draft);
    await this.actorAuras.syncDefinition(saved.id, game.actors?.contents ?? []);
    this.auras = await this.repository.list();
    this.selectedAuraId = saved.id;
    this.draft = cloneAuraDefinition(saved);
    this.activeEffectRef = null;
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    this.#markClean();
    ui.notifications.info(game.i18n.localize("PF2E_AURA_FORGE.Notifications.Saved"));
    await this.#renderPreservingScroll();
  }

  static async duplicateAura() {
    this.#syncDraftFromDom();
    if (!String(this.draft.name ?? "").trim()) {
      ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.NameRequired"));
      return;
    }
    const copy = cloneAuraDefinition(this.draft, {
      newIdentity: true,
      nameSuffix: game.i18n.localize("PF2E_AURA_FORGE.CopySuffix")
    });
    await this.repository.upsert(copy);
    this.auras = await this.repository.list();
    this.selectedAuraId = copy.id;
    this.draft = cloneAuraDefinition(copy);
    this.activeEffectRef = null;
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    this.#markClean();
    await this.#renderPreservingScroll();
  }

  static async deleteAura() {
    if (!this.selectedAuraId) return;
    const confirmed = await confirmDialog("PF2E_AURA_FORGE.Dialogs.DeleteTitle", "PF2E_AURA_FORGE.Dialogs.DeletePrompt");
    if (!confirmed) return;
    await this.actorAuras.removeDefinitionReferences(this.selectedAuraId, game.actors?.contents ?? []);
    await this.repository.remove(this.selectedAuraId);
    this.auras = await this.repository.list();
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    this.activeEffectRef = null;
    if (this.auras.length > 0) {
      this.selectedAuraId = this.auras[0].id;
      this.draft = cloneAuraDefinition(this.auras[0]);
    } else {
      this.selectedAuraId = null;
      this.draft = createAuraDefinition();
    }
    this.#markClean();
    this.#resetPreservedScroll();
    await this.render({ force: true });
  }

  static async addPresenceEffect() {
    this.#syncDraftFromDom();
    const entry = createPresenceEffect({ name: game.i18n.localize("PF2E_AURA_FORGE.NewPresenceEffect") });
    this.draft.presenceEffects.push(entry);
    this.activeEffectRef = `presence:${entry.id}`;
    this.#markDirty();
    await this.#renderPreservingScroll();
  }

  static async removePresenceEffect(_event, target) {
    this.#syncDraftFromDom();
    const id = target.dataset.presenceId;
    this.draft.presenceEffects = this.draft.presenceEffects.filter((entry) => entry.id !== id);
    if (this.activeEffectRef === `presence:${id}`) this.activeEffectRef = null;
    this.#markDirty();
    await this.#renderPreservingScroll();
  }

  static async editPresenceEffect(_event, target) {
    this.#syncDraftFromDom();
    const id = target.dataset.presenceId;
    this.activeEffectRef = this.activeEffectRef === `presence:${id}` ? null : `presence:${id}`;
    await this.#renderPreservingScroll();
  }

  static async addTrigger() {
    this.#syncDraftFromDom();
    this.draft.triggers.push(createAuraTrigger({ name: game.i18n.localize("PF2E_AURA_FORGE.NewTrigger") }));
    this.#markDirty();
    await this.#renderPreservingScroll();
  }

  static async removeTrigger(_event, target) {
    this.#syncDraftFromDom();
    const id = target.dataset.triggerId;
    this.draft.triggers = this.draft.triggers.filter((entry) => entry.id !== id);
    if (this.activeEffectRef?.startsWith(`trigger:${id}:`)) this.activeEffectRef = null;
    this.#markDirty();
    await this.#renderPreservingScroll();
  }

  static async editOutcomeEffect(_event, target) {
    this.#syncDraftFromDom();
    const triggerId = target.dataset.triggerId;
    const degree = target.dataset.degree;
    if (!DEGREE_KEYS.includes(degree)) return;
    const ref = `trigger:${triggerId}:${degree}`;
    this.activeEffectRef = this.activeEffectRef === ref ? null : ref;
    await this.#renderPreservingScroll();
  }

  static async clearOutcomeEffect(_event, target) {
    this.#syncDraftFromDom();
    const trigger = this.draft.triggers.find((entry) => entry.id === target.dataset.triggerId);
    const degree = target.dataset.degree;
    if (!trigger || !DEGREE_KEYS.includes(degree)) return;
    trigger.outcomes[degree] = null;
    if (this.activeEffectRef === `trigger:${trigger.id}:${degree}`) this.activeEffectRef = null;
    this.#markDirty();
    await this.#renderPreservingScroll();
  }

  static async closeEmbeddedEditor() {
    this.effectEditor?.unmount?.();
    this.effectEditor = null;
    this.activeEffectRef = null;
    await this.#renderPreservingScroll();
  }

  static async assignAura(_event, target) {
    const select = this.element?.querySelector?.('[name="assignActorId"]');
    const actorId = target?.dataset?.actorId || select?.value;
    const actor = game.actors?.get?.(actorId);
    try {
      return await this.#assignActor(actor);
    } catch (error) {
      console.error(`${MODULE_ID} | Actor assignment failed.`, error);
      ui.notifications.error(game.i18n.localize("PF2E_AURA_FORGE.Notifications.AssignmentFailed"));
      return false;
    }
  }

  static async assignSelectedToken() {
    const controlled = globalThis.canvas?.tokens?.controlled ?? [];
    if (controlled.length !== 1 || !controlled[0]?.actor) {
      ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.SelectOneToken"));
      return;
    }
    const actor = game.actors?.get?.(controlled[0].actor.id);
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("PF2E_AURA_FORGE.Notifications.WorldActorRequired"));
      return;
    }
    return this.constructor.assignAura.call(this, null, { dataset: { actorId: actor.id } });
  }

  static async toggleActorAura(_event, target) {
    const actor = game.actors?.get?.(target.dataset.actorId);
    if (!actor) return;
    await this.actorAuras.setEnabled(actor, target.dataset.instanceId, target.dataset.enabled !== "true");
    await this.#renderPreservingScroll();
  }

  static async removeActorAura(_event, target) {
    const actor = game.actors?.get?.(target.dataset.actorId);
    if (!actor) return;
    await this.actorAuras.remove(actor, target.dataset.instanceId);
    await this.#renderPreservingScroll();
  }

  static async updateRadiusOverride(_event, target) {
    const actor = game.actors?.get?.(target.dataset.actorId);
    if (!actor) return;
    const row = target.closest?.("[data-instance-id]");
    const input = row?.querySelector?.('[name="radiusOverride"]');
    await this.actorAuras.setRadiusOverride(actor, target.dataset.instanceId, input?.value ?? "");
    await this.#renderPreservingScroll();
  }

  static async closeWindow() {
    return this.close();
  }
}
