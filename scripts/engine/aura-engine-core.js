import {
  planPresenceReconciliation,
  planRuntimePresenceReconciliation
} from "./presence-reconciliation.js";

export class AuraEngineCore {
  /**
   * Canonical planner. Runtime-v1 is selected when scene/instance identity is
   * provided. The old token-bound argument shape remains accepted so 0.5.0
   * consumers do not break abruptly.
   */
  planPresence(options = {}) {
    if (options?.sceneId != null || options?.instanceId != null) {
      return planRuntimePresenceReconciliation(options);
    }
    return planPresenceReconciliation(options);
  }

  planPresenceRuntime(options) {
    return planRuntimePresenceReconciliation(options);
  }

  /** @deprecated Token-bound foundation planner retained for compatibility. */
  planPresenceLegacy(options) {
    return planPresenceReconciliation(options);
  }
}

export const auraEngineCore = new AuraEngineCore();
