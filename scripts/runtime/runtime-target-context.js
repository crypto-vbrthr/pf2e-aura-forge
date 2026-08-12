function actorTraits(actor) {
  if (actor?.traits instanceof Set) return new Set(actor.traits);
  const values = actor?.system?.traits?.value;
  return new Set(Array.isArray(values) ? values.map(String) : []);
}

function sameActor(source, target) {
  if (!source || !target) return false;
  if (source === target) return true;
  if (source.uuid && target.uuid) return source.uuid === target.uuid;
  return source.id && target.id && source.id === target.id;
}

export function classifyActorRelation(sourceActor, targetActor) {
  if (sameActor(sourceActor, targetActor)) return "source";
  if (typeof targetActor?.isAllyOf === "function" && targetActor.isAllyOf(sourceActor)) return "ally";
  if (typeof targetActor?.isEnemyOf === "function" && targetActor.isEnemyOf(sourceActor)) return "enemy";

  const sourceDisposition = Number(sourceActor?.token?.disposition ?? sourceActor?.prototypeToken?.disposition);
  const targetDisposition = Number(targetActor?.token?.disposition ?? targetActor?.prototypeToken?.disposition);
  if (sourceDisposition && targetDisposition && sourceDisposition === targetDisposition) return "ally";
  if (sourceDisposition && targetDisposition && Math.sign(sourceDisposition) !== Math.sign(targetDisposition)) return "enemy";
  return "neutral";
}

export function createRuntimeTargetContext(sourceToken, targetToken) {
  const sourceActor = sourceToken?.actor ?? null;
  const targetActor = targetToken?.actor ?? null;
  const relation = classifyActorRelation(sourceActor, targetActor);
  return {
    tokenId: targetToken?.id ?? null,
    tokenUuid: targetToken?.uuid ?? null,
    actorId: targetActor?.id ?? null,
    actorUuid: targetActor?.uuid ?? targetActor?.id ?? null,
    actor: targetActor,
    token: targetToken,
    isSource: relation === "source",
    disposition: relation === "source" ? "ally" : relation,
    traits: actorTraits(targetActor)
  };
}
