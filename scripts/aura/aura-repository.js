import { AURA_STORAGE_VERSION } from "../constants.js";
import { cloneAuraDefinition, createAuraDefinition } from "./aura-definition.js";
import { migrateAuraDefinition } from "./aura-migrations.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function createEmptyAuraLibrary() {
  return { storageVersion: AURA_STORAGE_VERSION, auras: [] };
}

export class AuraRepository {
  constructor(storage) {
    if (!storage?.get || !storage?.set) throw new TypeError("AuraRepository requires get/set storage methods.");
    this.storage = storage;
  }

  async readLibrary() {
    const raw = await this.storage.get();
    const library = raw && typeof raw === "object" && !Array.isArray(raw)
      ? clone(raw)
      : createEmptyAuraLibrary();
    const auras = Array.isArray(library.auras) ? library.auras : [];
    return {
      ...library,
      storageVersion: AURA_STORAGE_VERSION,
      auras: auras.map((entry) => migrateAuraDefinition(entry).definition)
    };
  }

  async writeLibrary(library) {
    const normalized = {
      ...clone(library),
      storageVersion: AURA_STORAGE_VERSION,
      auras: Array.isArray(library?.auras)
        ? library.auras.map((entry) => createAuraDefinition(entry))
        : []
    };
    await this.storage.set(normalized);
    return clone(normalized);
  }

  async list() {
    const library = await this.readLibrary();
    return library.auras.map((entry) => clone(entry));
  }

  async get(id) {
    const library = await this.readLibrary();
    const found = library.auras.find((entry) => entry.id === id);
    return found ? clone(found) : null;
  }

  async upsert(definition) {
    const library = await this.readLibrary();
    const normalized = createAuraDefinition(definition);
    const index = library.auras.findIndex((entry) => entry.id === normalized.id);
    if (index >= 0) library.auras[index] = normalized;
    else library.auras.push(normalized);
    await this.writeLibrary(library);
    return clone(normalized);
  }

  async remove(id) {
    const library = await this.readLibrary();
    const before = library.auras.length;
    library.auras = library.auras.filter((entry) => entry.id !== id);
    if (library.auras.length === before) return false;
    await this.writeLibrary(library);
    return true;
  }

  async duplicate(id, { nameSuffix = " Copy" } = {}) {
    const source = await this.get(id);
    if (!source) return null;
    const copy = cloneAuraDefinition(source, { newIdentity: true, nameSuffix });
    await this.upsert(copy);
    return copy;
  }
}
