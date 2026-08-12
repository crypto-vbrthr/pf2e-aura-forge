import test from "node:test";
import assert from "node:assert/strict";
import { AuraRuntimeSocketService, SOCKET_CHANNEL } from "../scripts/runtime/runtime-socket-service.js";

class SocketNetwork {
  constructor() { this.endpoints = []; }
  endpoint() {
    const endpoint = {
      handlers: new Map(),
      on: (channel, fn) => endpoint.handlers.set(channel, fn),
      off: (channel) => endpoint.handlers.delete(channel),
      emit: (channel, packet) => {
        for (const other of this.endpoints) {
          if (other === endpoint) continue;
          other.handlers.get(channel)?.(structuredClone(packet));
        }
      }
    };
    this.endpoints.push(endpoint);
    return endpoint;
  }
}

function usersCollection(users, activeGM) {
  return { contents: users, activeGM };
}

test("request-mode saves are routed from the GM coordinator to the active player owner and back", async () => {
  const network = new SocketNetwork();
  const gmSocket = network.endpoint();
  const playerSocket = network.endpoint();
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true, character: { id: "target" } };
  const users = usersCollection([gm, player], gm);

  const gmTarget = { id: "target", primaryUpdater: gm };
  const playerTarget = { id: "target", primaryUpdater: gm };
  const token = { id: "target-token", actor: playerTarget };
  const scene = { id: "scene", tokens: { get: (id) => id === token.id ? token : null } };
  token.parent = scene;

  let playerRolls = 0;
  const playerRuntime = {
    saveResolution: {
      async roll({ trigger }) {
        playerRolls += 1;
        assert.equal(trigger.save.type, "fortitude");
        return { status: "resolved", degree: "failure", saveType: "fortitude", dc: 23 };
      }
    }
  };
  const gmRuntime = { saveResolution: { async roll() { throw new Error("GM must not roll request-mode owner save locally"); } } };

  const gmGame = { user: gm, users, socket: gmSocket };
  const playerGame = {
    user: player,
    users,
    socket: playerSocket,
    actors: { get: (id) => id === "target" ? playerTarget : null },
    scenes: { get: (id) => id === "scene" ? scene : null }
  };

  const gmService = new AuraRuntimeSocketService({ runtime: gmRuntime, gameRef: gmGame, socket: gmSocket, timeoutMs: 1000 });
  const playerService = new AuraRuntimeSocketService({ runtime: playerRuntime, gameRef: playerGame, socket: playerSocket, timeoutMs: 1000 });
  gmService.register();
  playerService.register();

  const result = await gmService.resolveSave({
    targetActor: gmTarget,
    targetToken: { id: "target-token", parent: scene },
    sourceActor: { id: "source" },
    trigger: { id: "enter", event: "enter", save: { enabled: true, type: "fortitude", mode: "request", dc: { value: 23 } } },
    aura: { id: "aura", name: "Aura" }
  });

  assert.equal(playerRolls, 1);
  assert.equal(result.status, "resolved");
  assert.equal(result.degree, "failure");
  assert.equal(SOCKET_CHANNEL, "module.pf2e-aura-forge");
  gmService.destroy();
  playerService.destroy();
});

test("remote saves prefer token-scoped synthetic actors over same-id world actors", async () => {
  const network = new SocketNetwork();
  const gmSocket = network.endpoint();
  const playerSocket = network.endpoint();
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true, character: { id: "target" } };
  const users = usersCollection([gm, player], gm);

  const worldTarget = { id: "target", marker: "world-target" };
  const worldSource = { id: "source", marker: "world-source" };
  const syntheticTarget = { id: "target", marker: "synthetic-target" };
  const syntheticSource = { id: "source", marker: "synthetic-source" };
  const targetToken = { id: "target-token", actor: syntheticTarget };
  const sourceToken = { id: "source-token", actor: syntheticSource };
  const scene = {
    id: "scene",
    tokens: {
      get(id) {
        if (id === targetToken.id) return targetToken;
        if (id === sourceToken.id) return sourceToken;
        return null;
      }
    }
  };
  targetToken.parent = sourceToken.parent = scene;

  const playerRuntime = {
    saveResolution: {
      async roll({ targetActor, sourceActor }) {
        assert.equal(targetActor.marker, "synthetic-target");
        assert.equal(sourceActor.marker, "synthetic-source");
        return { status: "resolved", degree: "success", saveType: "will", dc: 20 };
      }
    }
  };
  const gmRuntime = { saveResolution: { async roll() { throw new Error("GM should route this save"); } } };
  const gmGame = { user: gm, users, socket: gmSocket };
  const playerGame = {
    user: player,
    users,
    socket: playerSocket,
    actors: {
      get(id) {
        if (id === "target") return worldTarget;
        if (id === "source") return worldSource;
        return null;
      }
    },
    scenes: { get: (id) => id === scene.id ? scene : null }
  };

  const gmService = new AuraRuntimeSocketService({ runtime: gmRuntime, gameRef: gmGame, socket: gmSocket, timeoutMs: 1000 });
  const playerService = new AuraRuntimeSocketService({ runtime: playerRuntime, gameRef: playerGame, socket: playerSocket, timeoutMs: 1000 });
  gmService.register();
  playerService.register();

  const result = await gmService.resolveSave({
    targetActor: { id: "target" },
    targetToken,
    sourceActor: { id: "source" },
    sourceToken,
    trigger: { id: "enter", event: "enter", save: { enabled: true, type: "will", mode: "request", dc: { value: 20 } } },
    aura: { id: "aura", name: "Aura" }
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.degree, "success");
  gmService.destroy();
  playerService.destroy();
});
