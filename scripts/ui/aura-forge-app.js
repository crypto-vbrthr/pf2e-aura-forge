import { MODULE_ID, SETTINGS } from "../constants.js";
import { cloneAuraDefinition, createAuraDefinition } from "../aura/aura-definition.js";
import { createFoundryAuraRepository } from "../aura/foundry-aura-repository.js";
import { ActorAuraService } from "../actor/actor-aura-service.js";
import { assertEffectForgeApi, getEffectForgeApi } from "../integration/effect-forge-bridge.js";
import {
  createAuraEditorSession,
  createEmbeddedAuraEditor
} from "./aura-editor.js";
import { captureScrollState, restoreScrollState } from "./view-state.js";
import {
  AURA_FORGE_DEFAULT_WINDOW_SIZE,
  normalizeSavedWindowState,
  normalizeWindowState
} from "./window-state.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    this.editorSession = createAuraEditorSession(createAuraDefinition(), {
      context: { usage: "aura-forge" }
    });
    this.auraEditor = createEmbeddedAuraEditor({
      session: this.editorSession,
      context: { usage: "aura-forge" },
      layout: "full",
      onChange: () => this.#onEditorChange()
    });
    this.allowCloseWithoutPrompt = false;
    this.windowStateTimer = null;
    this.preservedScrollState = new Map();
    this.initialized = false;
  }

  get draft() {
    return this.editorSession.state;
  }

  get isDirty() {
    return Boolean(this.editorSession.dirty);
  }

  get validation() {
    return this.editorSession.validation;
  }

  async initialize() {
    this.auras = await this.repository.list();
    if (this.auras.length > 0) {
      this.selectedAuraId = this.auras[0].id;
      this.editorSession.loadDefinition(this.auras[0], { context: { usage: "aura-forge" } });
    } else {
      this.editorSession.loadDefinition(createAuraDefinition(), { context: { usage: "aura-forge" } });
    }
    this.auraEditor.resetUiState();
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
      selectedAuraId: this.selectedAuraId,
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

    this.#setupActorDropZone(root);
    const host = root.querySelector("[data-aura-editor-host]");
    if (host instanceof HTMLElement) {
      this.auraEditor.mount(host, { layout: "full", validation: this.validation })
        .then(() => this.#restoreScrollPositions())
        .catch((error) => {
          console.error(`${MODULE_ID} | Embedded Aura Editor mount failed.`, error);
          ui.notifications.error(game.i18n.localize("PF2E_AURA_FORGE.Notifications.AuraEditorFailed"));
          this.#restoreScrollPositions();
        });
    } else {
      this.#restoreScrollPositions();
    }
    this.#updateDirtyIndicator();
    this.#updateAssignmentAvailability();
  }

  #onEditorChange() {
    this.#updateDirtyIndicator();
    this.#updateAssignmentAvailability();
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

  #updateAssignmentAvailability() {
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    const canAssign = Boolean(this.selectedAuraId && !this.isDirty);
    const section = root.querySelector("[data-instance-controls]");
    if (!(section instanceof HTMLElement)) return;
    for (const control of section.querySelectorAll('[name="assignActorId"], [data-action="assignAura"], [data-action="assignSelectedToken"]')) {
      control.disabled = !canAssign;
    }
    section.querySelector("[data-actor-drop-zone]")?.classList.toggle("disabled", !canAssign);
    const hint = section.querySelector("[data-save-before-assign-hint]");
    if (hint) hint.hidden = canAssign;
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
    if (data.uuid && typeof globalThis.fromUuid === "function") document = await globalThis.fromUuid(data.uuid);
    document ??= data.id ? game.actors?.get?.(data.id) : null;
    if (!document || (document.documentName && document.documentName !== "Actor")) return null;
    return game.actors?.get?.(document.id) ?? null;
  }

  async #assignActor(actor) {
    this.auraEditor.sync();
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
    this.auraEditor.sync();
    if (!this.allowCloseWithoutPrompt && this.isDirty) {
      const confirmed = await confirmDialog(
        "PF2E_AURA_FORGE.Dialogs.DiscardTitle",
        "PF2E_AURA_FORGE.Dialogs.DiscardPrompt"
      );
      if (!confirmed) return this;
    }
    this.allowCloseWithoutPrompt = false;
    this.auraEditor.unmount({ clearContainer: false, preserveEffectRef: false });
    globalThis.clearTimeout(this.windowStateTimer);
    await this.#persistWindowState();
    return super.close(options);
  }

  #captureScrollPositions() {
    const root = this.element;
    this.preservedScrollState = root instanceof HTMLElement ? captureScrollState(root) : new Map();
  }

  #restoreScrollPositions() {
    if (!(this.preservedScrollState instanceof Map) || this.preservedScrollState.size === 0) return;
    const state = this.preservedScrollState;
    this.preservedScrollState = new Map();
    const restore = () => {
      const root = this.element;
      if (root instanceof HTMLElement) restoreScrollState(root, state);
    };
    if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(restore);
    else globalThis.setTimeout(restore, 0);
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
    this.selectedAuraId = aura.id;
    this.editorSession.loadDefinition(aura, { context: { usage: "aura-forge" } });
    this.auraEditor.resetUiState();
    this.#resetPreservedScroll();
    await this.render({ force: true });
    return true;
  }

  async #confirmDiscardIfNeeded() {
    if (!this.isDirty) return true;
    return confirmDialog("PF2E_AURA_FORGE.Dialogs.DiscardTitle", "PF2E_AURA_FORGE.Dialogs.DiscardPrompt");
  }

  static async newAura() {
    this.auraEditor.sync();
    if (!await this.#confirmDiscardIfNeeded()) return;
    this.selectedAuraId = null;
    this.editorSession.loadDefinition(createAuraDefinition(), { context: { usage: "aura-forge" } });
    this.auraEditor.resetUiState();
    this.#resetPreservedScroll();
    await this.render({ force: true });
  }

  static async selectAura(_event, target) {
    const id = target.dataset.auraId;
    if (!id || id === this.selectedAuraId) return;
    this.auraEditor.sync();
    if (!await this.#confirmDiscardIfNeeded()) return;
    await this.#loadAura(id);
  }

  static async saveAura() {
    this.auraEditor.sync();
    const validation = this.auraEditor.validate();
    if (!validation.valid) {
      const details = validation.errors.slice(0, 5).map((entry) => `• ${entry.message}`).join("\n");
      ui.notifications.error(`${game.i18n.localize("PF2E_AURA_FORGE.Notifications.ValidationFailed")}\n${details}`);
      await this.#renderPreservingScroll();
      return;
    }

    const saved = await this.repository.upsert(this.auraEditor.value);
    await this.actorAuras.syncDefinition(saved.id, game.actors?.contents ?? []);
    this.auras = await this.repository.list();
    this.selectedAuraId = saved.id;
    this.editorSession.loadDefinition(saved, { context: { usage: "aura-forge" } });
    this.auraEditor.resetUiState();
    ui.notifications.info(game.i18n.localize("PF2E_AURA_FORGE.Notifications.Saved"));
    await this.#renderPreservingScroll();
  }

  static async duplicateAura() {
    this.auraEditor.sync();
    const validation = this.auraEditor.validate();
    if (!validation.valid) {
      const details = validation.errors.slice(0, 5).map((entry) => `• ${entry.message}`).join("\n");
      ui.notifications.error(`${game.i18n.localize("PF2E_AURA_FORGE.Notifications.ValidationFailed")}\n${details}`);
      await this.#renderPreservingScroll();
      return;
    }
    const copy = cloneAuraDefinition(this.auraEditor.value, {
      newIdentity: true,
      nameSuffix: game.i18n.localize("PF2E_AURA_FORGE.CopySuffix")
    });
    await this.repository.upsert(copy);
    this.auras = await this.repository.list();
    this.selectedAuraId = copy.id;
    this.editorSession.loadDefinition(copy, { context: { usage: "aura-forge" } });
    this.auraEditor.resetUiState();
    await this.#renderPreservingScroll();
  }

  static async deleteAura() {
    if (!this.selectedAuraId) return;
    const confirmed = await confirmDialog("PF2E_AURA_FORGE.Dialogs.DeleteTitle", "PF2E_AURA_FORGE.Dialogs.DeletePrompt");
    if (!confirmed) return;
    await this.actorAuras.removeDefinitionReferences(this.selectedAuraId, game.actors?.contents ?? []);
    await this.repository.remove(this.selectedAuraId);
    this.auras = await this.repository.list();
    this.auraEditor.resetUiState();
    if (this.auras.length > 0) {
      this.selectedAuraId = this.auras[0].id;
      this.editorSession.loadDefinition(this.auras[0], { context: { usage: "aura-forge" } });
    } else {
      this.selectedAuraId = null;
      this.editorSession.loadDefinition(createAuraDefinition(), { context: { usage: "aura-forge" } });
    }
    this.#resetPreservedScroll();
    await this.render({ force: true });
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
