import { MODULE_ID } from "../constants.js";
import { resolveSaveUser } from "./save-resolution-service.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const DEFAULT_TIMEOUT_MS = 300_000;

function randomId() {
  return globalThis.foundry?.utils?.randomID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sameUser(a, b) {
  return Boolean(a && b && String(a.id ?? "") === String(b.id ?? ""));
}

function tokenById(scene, id) {
  return scene?.tokens?.get?.(id)
    ?? scene?.tokens?.contents?.find?.((token) => token.id === id)
    ?? null;
}

export class AuraRuntimeSocketService {
  constructor({ runtime, gameRef = globalThis.game, socket = gameRef?.socket, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.runtime = runtime;
    this.gameRef = gameRef;
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.registered = false;
    this.handler = (packet) => { void this.#onPacket(packet); };
  }

  register() {
    if (this.registered || typeof this.socket?.on !== "function") return false;
    this.socket.on(SOCKET_CHANNEL, this.handler);
    this.registered = true;
    return true;
  }

  destroy() {
    if (this.registered && typeof this.socket?.off === "function") this.socket.off(SOCKET_CHANNEL, this.handler);
    this.registered = false;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ status: "cancelled", degree: null, reason: "socket-destroyed" });
    }
    this.pending.clear();
  }

  async resolveSave({ targetActor, targetToken, sourceActor, trigger, aura }) {
    const mode = trigger?.save?.mode ?? "request";
    const resolver = resolveSaveUser(targetActor, mode, this.gameRef);
    if (!resolver) return { status: "unavailable", degree: null, reason: "no-resolver" };

    if (sameUser(resolver, this.gameRef?.user)) {
      return this.runtime.saveResolution.roll({ targetActor, targetToken, sourceActor, trigger, aura });
    }

    if (typeof this.socket?.emit !== "function") {
      return { status: "unavailable", degree: null, reason: "socket-unavailable" };
    }

    const requestId = randomId();
    const requesterUserId = this.gameRef?.user?.id ?? null;
    const packet = {
      type: "save-request",
      requestId,
      requesterUserId,
      resolverUserId: resolver.id,
      sceneId: targetToken?.parent?.id ?? targetToken?.scene?.id ?? globalThis.canvas?.scene?.id ?? null,
      targetActorId: targetActor?.id ?? null,
      targetTokenId: targetToken?.id ?? null,
      sourceActorId: sourceActor?.id ?? null,
      trigger: structuredClone(trigger),
      aura: structuredClone(aura)
    };

    const response = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ status: "timeout", degree: null });
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, timer });
    });

    this.socket.emit(SOCKET_CHANNEL, packet);
    return response;
  }

  async #onPacket(packet) {
    if (!packet || typeof packet !== "object") return;

    if (packet.type === "save-response") {
      if (String(packet.requesterUserId ?? "") !== String(this.gameRef?.user?.id ?? "")) return;
      const pending = this.pending.get(packet.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(packet.requestId);
      pending.resolve(packet.result ?? { status: "unavailable", degree: null });
      return;
    }

    if (packet.type !== "save-request") return;
    if (String(packet.resolverUserId ?? "") !== String(this.gameRef?.user?.id ?? "")) return;

    const scene = this.gameRef?.scenes?.get?.(packet.sceneId) ?? globalThis.canvas?.scene ?? null;
    const targetActor = this.gameRef?.actors?.get?.(packet.targetActorId) ?? tokenById(scene, packet.targetTokenId)?.actor ?? null;
    const targetToken = tokenById(scene, packet.targetTokenId);
    const sourceActor = this.gameRef?.actors?.get?.(packet.sourceActorId) ?? null;

    let result;
    try {
      result = await this.runtime.saveResolution.roll({
        targetActor,
        targetToken,
        sourceActor,
        trigger: packet.trigger,
        aura: packet.aura
      });
    } catch (error) {
      result = { status: "error", degree: null, message: String(error?.message ?? error) };
    }

    this.socket?.emit?.(SOCKET_CHANNEL, {
      type: "save-response",
      requestId: packet.requestId,
      requesterUserId: packet.requesterUserId,
      resolverUserId: packet.resolverUserId,
      result: {
        status: result?.status ?? "unavailable",
        degree: result?.degree ?? null,
        saveType: result?.saveType ?? packet.trigger?.save?.type ?? null,
        dc: result?.dc ?? (Number(packet.trigger?.save?.dc?.value) || 0),
        ...(result?.reason ? { reason: result.reason } : {})
      }
    });
  }
}

export { SOCKET_CHANNEL };
