import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  digestPortfolioValue,
  PortfolioRepository,
  type PortfolioTaskAttempt,
  type PortfolioWorkItem
} from "../src/db/repositories/portfolio-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../src/db/repositories/session-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { PortfolioIntakeService } from "../src/services/portfolio/intake-service.js";
import type { ApprovedProjectRootIdentity } from "../src/services/portfolio/observation-contract.js";
import { createPlatformToolManifestService } from "../src/services/portfolio/platform-tool-manifest.js";
import { createTaskPacketService } from "../src/services/portfolio/task-packet-service.js";

export interface PortfolioPhase4Fixture {
  db: Database.Database;
  owner: User;
  projectId: string;
  repository: PortfolioRepository;
  session: Session;
  workItem: PortfolioWorkItem;
}

export interface PortfolioPhase4FixtureOptions {
  db?: Database.Database;
  ownerEmail?: string;
  fixtureKey?: string;
}

/**
 * Uses all Gateway migrations so execution tests exercise durable constraints
 * instead of reimplementing a partial Portfolio schema in each test file.
 */
export function createPortfolioPhase4Fixture(options: PortfolioPhase4FixtureOptions = {}): PortfolioPhase4Fixture {
  const db = options.db ?? new Database(":memory:");
  const fixtureKey = options.fixtureKey ?? (options.ownerEmail ? options.ownerEmail.replace(/[^a-zA-Z0-9]/g, "_") : "");
  const unique = (value: string) => fixtureKey ? `${value}:${fixtureKey}` : value;
  db.pragma("foreign_keys = ON");
  if (!options.db) {
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
  }

  const owner = new UserRepository(db).create(options.ownerEmail ?? "portfolio-phase4-owner@example.com", "hash");
  const project = new ProjectRepository(db, owner.id).create({
    name: "Portfolio Phase 4 project",
    path: "/tmp/forgebadger-portfolio-phase4",
    aiTool: "claude"
  });
  const intake = new PortfolioIntakeService(db, owner.id);
  const enrollmentEvidenceId = unique("evidence:portfolio-phase4:enrollment");
  intake.enrollProject({
    projectId: project.id,
    objective: "Execute only durable, governed Portfolio work.",
    intendedOutcome: "A packet can dispatch only through its assigned worker.",
    observedState: { status: "verified", source: "portfolio-phase4-fixture" },
    evidenceIds: [enrollmentEvidenceId],
    initialEvidence: [{
      id: enrollmentEvidenceId,
      producer: "portfolio-phase4-fixture",
      sourceCategory: "test",
      observedAt: new Date("2026-08-14T00:00:00.000Z"),
      digest: "sha256:portfolio-phase4-enrollment",
      summary: "Trusted current Portfolio enrollment evidence.",
      confidence: "high",
      freshness: "current"
    }],
    idempotencyKey: unique("enrollment:portfolio-phase4")
  });

  const repository = new PortfolioRepository(db, owner.id);
  const request = intake.createRequest({
    projectId: project.id,
    source: "web",
    requestText: "Implement the narrowly-scoped, approved Gateway behavior.",
    correlationId: unique("correlation:portfolio-phase4"),
    idempotencyKey: unique("request:portfolio-phase4")
  });
  const requestEvidence = repository.createEvidence({
    projectId: project.id,
    requestId: request.id,
    producer: "portfolio-phase4-fixture",
    sourceCategory: "test",
    observedAt: new Date("2026-08-14T00:00:01.000Z"),
    digest: "sha256:portfolio-phase4-request",
    summary: "Trusted evidence supports the requested in-boundary work.",
    confidence: "high",
    freshness: "current",
    idempotencyKey: unique("evidence:portfolio-phase4-request")
  });
  const intakeOutcome = intake.decideIntake({
    requestId: request.id,
    candidateProjectIds: [project.id],
    selectedProjectId: project.id,
    scopeAssessment: "in_boundary",
    producer: "portfolio-phase4-fixture",
    evidenceIds: [requestEvidence.id],
    workItem: {
      title: "Governed Phase 4 execution fixture",
      description: "Only the canonical deterministic packet is eligible for dispatch.",
      acceptanceCriteria: ["The dispatch receipt is durable and packet-bound."],
      verificationRequirements: ["gateway-integration"]
    },
    idempotencyKey: unique("intake:portfolio-phase4")
  });
  if (!intakeOutcome.workItem) throw new Error("Phase 4 fixture requires an accepted Intake Decision");
  const workItem = intakeOutcome.workItem;
  const session = new SessionRepository(db, owner.id).create({
    projectId: project.id,
    name: "Portfolio Phase 4 Claude session",
    aiTool: "claude",
    workingDir: project.path,
    attachToken: "browser-attach-token-must-not-ack",
    tmuxSession: "of-portfolio-phase4"
  });

  return { db, owner, projectId: project.id, repository, session, workItem };
}

/** Activates the fixed V1 profile with a fake-test-owned canonical root identity. */
export function activatePortfolioObservationProfile(
  fixture: Pick<PortfolioPhase4Fixture, "repository" | "projectId">,
  approvedRoot: ApprovedProjectRootIdentity,
  now: Date
): void {
  fixture.repository.activateObservationProfile({
    projectId: fixture.projectId,
    approvedRoot,
    idempotencyKey: `observation-profile:${approvedRoot.device}:${approvedRoot.inode}`,
    now
  });
}

/** Simulates a separately persisted Work Item edit between prepare and dispatch. */
export function mutateWorkItemForPacketDrift(fixture: PortfolioPhase4Fixture): void {
  fixture.db.prepare(`UPDATE portfolio_work_items
    SET acceptance_criteria_json = ?, projection_version = projection_version + 1, updated_at = ?
    WHERE id = ? AND user_id = ?`).run(
    JSON.stringify(["The changed criterion requires a new packet."]),
    Date.now(),
    fixture.workItem.id,
    fixture.owner.id
  );
}

/** Creates direct repository Attempts only from the executable server-owned packet contract. */
export function createExecutablePortfolioAttempt(
  repository: PortfolioRepository,
  input: {
    projectId: string;
    workItemId: string;
    packetVersion: number;
    packetDigest?: string;
    adapter: string;
    createdBy: string;
    sourceWorkItemVersion?: number;
    requestId?: string;
    trackingEnabled?: boolean;
    idempotencyKey: string;
  }
): PortfolioTaskAttempt {
  const packets = createTaskPacketService(repository, createPlatformToolManifestService());
  const canonicalPacket = packets.rebuild({
    projectId: input.projectId,
    workItemId: input.workItemId,
    adapter: input.adapter,
    skillVersion: "portfolio-execution/v1",
    toolIds: ["portfolio.submit_canonical_task_packet"]
  });
  const packetDigest = digestPortfolioValue(canonicalPacket);
  const packet = repository.findTaskPacketByDigest(input.workItemId, packetDigest)
    ?? repository.createTaskPacket({
      projectId: input.projectId,
      workItemId: input.workItemId,
      packetVersion: input.packetVersion,
      packetDigest,
      skillVersion: canonicalPacket.skill.version,
      sourceWorkItemVersion: canonicalPacket.workItem.projectionVersion,
      dossierVersion: canonicalPacket.project.dossierVersion,
      canonicalPacket,
      manifestVersion: canonicalPacket.platformTools.manifestVersion,
      manifestDigest: canonicalPacket.platformTools.manifestDigest,
      createdBy: input.createdBy,
      idempotencyKey: `packet:${input.idempotencyKey}`
    });
  return repository.createTaskAttempt({
    projectId: input.projectId,
    workItemId: input.workItemId,
    packetVersion: packet.packetVersion,
    packetDigest: packet.packetDigest,
    adapter: input.adapter,
    createdBy: input.createdBy,
    sourceWorkItemVersion: packet.sourceWorkItemVersion,
    ...(input.trackingEnabled !== undefined ? { trackingEnabled: input.trackingEnabled } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    packetId: packet.id,
    idempotencyKey: input.idempotencyKey
  });
}
