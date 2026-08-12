import { planPresenceReconciliation } from "./presence-reconciliation.js";

export class AuraEngineCore {
  planPresence(options) {
    return planPresenceReconciliation(options);
  }
}

export const auraEngineCore = new AuraEngineCore();
