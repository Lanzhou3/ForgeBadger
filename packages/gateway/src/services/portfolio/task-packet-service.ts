import {
  digestPortfolioValue,
  type PortfolioRepository,
  type PortfolioTaskAttempt,
  type PortfolioTaskPacket
} from "../../db/repositories/portfolio-repository.js";
import type { PlatformToolDefinition, SelectedPlatformTools } from "./platform-tool-manifest.js";
import { PORTFOLIO_EXECUTION_SKILL_VERSION } from "./execution-contract.js";

export interface CanonicalTaskPacket {
  [key: string]: unknown;
  version: 1;
  project: { id: string; objective: string; intendedOutcome: string; scope: Record<string, unknown>; dossierVersion: number };
  workItem: { id: string; title: string; description: string | null; acceptanceCriteria: string[]; verificationRequirements: string[]; projectionVersion: number };
  execution: { adapter: string };
  skill: { version: string; toolIds: string[] };
  platformTools: { manifestVersion: string; manifestDigest: string; tools: Array<Pick<PlatformToolDefinition, "id" | "version" | "actionClass">> };
}

export interface PreparedTaskAttempt {
  packet: PortfolioTaskPacket & { canonicalPacket: CanonicalTaskPacket };
  attempt: PortfolioTaskAttempt;
}

type ManifestService = ReturnType<typeof import("./platform-tool-manifest.js")["createPlatformToolManifestService"]>;

function asCanonicalPacket(packet: Record<string, unknown>): CanonicalTaskPacket {
  return packet as unknown as CanonicalTaskPacket;
}

function executableSkill(packet: CanonicalTaskPacket): { version: string; toolIds: string[] } {
  const skill = packet.skill as unknown;
  if (!skill || typeof skill !== "object" || Array.isArray(skill)) throw new Error("PORTFOLIO_EXECUTABLE_MANIFEST_REQUIRED");
  const value = skill as Record<string, unknown>;
  if (typeof value.version !== "string" || !Array.isArray(value.toolIds)
    || value.toolIds.some((toolId) => typeof toolId !== "string")) {
    throw new Error("PORTFOLIO_EXECUTABLE_MANIFEST_REQUIRED");
  }
  return { version: value.version, toolIds: value.toolIds as string[] };
}

function storedManifestDigest(packet: CanonicalTaskPacket): string {
  const platformTools = packet.platformTools as unknown;
  if (!platformTools || typeof platformTools !== "object" || Array.isArray(platformTools)) {
    throw new Error("PORTFOLIO_EXECUTABLE_MANIFEST_REQUIRED");
  }
  const digest = (platformTools as Record<string, unknown>).manifestDigest;
  if (typeof digest !== "string" || !digest.trim()) throw new Error("PORTFOLIO_EXECUTABLE_MANIFEST_REQUIRED");
  return digest;
}

function packetTools(selection: SelectedPlatformTools): CanonicalTaskPacket["platformTools"] {
  return {
    manifestVersion: selection.manifestVersion,
    manifestDigest: selection.manifestDigest,
    tools: selection.tools.map(({ id, version, actionClass }) => ({ id, version, actionClass }))
  };
}

/** Builds packets solely from durable Portfolio sources and static server manifests. */
export function createTaskPacketService(repository: PortfolioRepository, manifestService: ManifestService) {
  function rebuild(input: { projectId: string; workItemId: string; adapter: string; skillVersion: string; toolIds: string[]; manifestVersion?: string }): CanonicalTaskPacket {
    const dossier = repository.getCurrentDossier(input.projectId);
    const workItem = repository.getWorkItem(input.workItemId);
    if (!dossier || !workItem || workItem.projectId !== input.projectId) throw new Error("PORTFOLIO_PACKET_SOURCE_NOT_FOUND");
    const selection = manifestService.selectExecutable({ skillVersion: input.skillVersion, toolIds: input.toolIds,
      ...(input.manifestVersion ? { manifestVersion: input.manifestVersion } : {}) });
    return {
      version: 1,
      project: { id: input.projectId, objective: dossier.objective, intendedOutcome: dossier.intendedOutcome, scope: dossier.scope, dossierVersion: dossier.projectionVersion },
      workItem: { id: workItem.id, title: workItem.title, description: workItem.description, acceptanceCriteria: workItem.acceptanceCriteria,
        verificationRequirements: workItem.verificationRequirements, projectionVersion: workItem.projectionVersion },
      execution: { adapter: input.adapter },
      skill: { version: selection.skillVersion, toolIds: selection.tools.map((tool) => tool.id) },
      platformTools: packetTools(selection)
    };
  }

  function prepareAttempt(input: { projectId: string; workItemId: string; adapter: string; createdBy: string; idempotencyKey: string; skillVersion: string; toolIds: string[]; trackingEnabled?: boolean }): PreparedTaskAttempt {
    const canonicalPacket = rebuild(input);
    const packetDigest = digestPortfolioValue(canonicalPacket);
    const prepared = repository.prepareTaskAttempt({
      projectId: input.projectId, workItemId: input.workItemId, packetDigest, skillVersion: canonicalPacket.skill.version,
      sourceWorkItemVersion: canonicalPacket.workItem.projectionVersion, dossierVersion: canonicalPacket.project.dossierVersion,
      canonicalPacket, manifestVersion: canonicalPacket.platformTools.manifestVersion, manifestDigest: canonicalPacket.platformTools.manifestDigest,
      adapter: input.adapter, createdBy: input.createdBy, idempotencyKey: input.idempotencyKey,
      ...(input.trackingEnabled ? { trackingEnabled: true } : {})
    });
    return { packet: { ...prepared.packet, canonicalPacket: prepared.packet.canonicalPacket as CanonicalTaskPacket }, attempt: prepared.attempt };
  }

  function validateAttempt(attemptId: string): CanonicalTaskPacket {
    const attempt = repository.getTaskAttempt(attemptId);
    const packet = attempt?.packetId ? repository.getTaskPacket(attempt.packetId) : undefined;
    if (!attempt || !packet || packet.packetDigest !== attempt.packetDigest || digestPortfolioValue(packet.canonicalPacket) !== packet.packetDigest) {
      throw new Error("PORTFOLIO_PACKET_DRIFT");
    }
    const manifest = manifestService.get(packet.manifestVersion);
    const canonicalPacket = asCanonicalPacket(packet.canonicalPacket);
    const skill = executableSkill(canonicalPacket);
    if (manifest.digest !== packet.manifestDigest || storedManifestDigest(canonicalPacket) !== packet.manifestDigest) {
      throw new Error("PORTFOLIO_PACKET_MANIFEST_DRIFT");
    }
    if (packet.skillVersion !== PORTFOLIO_EXECUTION_SKILL_VERSION || skill.version !== packet.skillVersion
      || skill.toolIds.length === 0) throw new Error("PORTFOLIO_EXECUTABLE_MANIFEST_REQUIRED");
    const rebuilt = rebuild({ projectId: packet.projectId, workItemId: packet.workItemId, adapter: attempt.adapter,
      skillVersion: packet.skillVersion, toolIds: skill.toolIds, manifestVersion: packet.manifestVersion });
    if (digestPortfolioValue(rebuilt) !== attempt.packetDigest) throw new Error("PORTFOLIO_PACKET_DRIFT");
    return canonicalPacket;
  }

  return { rebuild, prepareAttempt, validateAttempt };
}
