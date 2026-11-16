import { describe, expect, it } from "vitest";
import { columnOf, deriveBoard, deriveCard } from "./fleet-board-model";
import { fleetTask, reviewAttempt, taskTeam } from "./fleet-fixtures";

const dispatched = { dispatchedSessionId: "s1" } as const;
const column = (task: ReturnType<typeof fleetTask>, team?: ReturnType<typeof taskTeam>) => deriveCard(task, team).column;

describe("fleet board columns", () => {
  it("walks one task through every column", () => {
    expect(column(fleetTask())).toBe("queue");
    expect(column(fleetTask({ status: "in_progress" }))).toBe("write");
    expect(column(fleetTask({ ...dispatched, dispatchStatus: "running" }), taskTeam())).toBe("write");
    expect(column(fleetTask({ ...dispatched, dispatchStatus: "completed" }), taskTeam())).toBe("verify");
    expect(column(fleetTask({ ...dispatched, dispatchStatus: "completed", verifiedAt: 5, verifyExitCode: 1 }), taskTeam())).toBe("verify");
    const running = taskTeam({ review: { rounds: 0, roundsLeft: 2, attempts: [reviewAttempt({ status: "running", verdict: null, findings: [] })] } });
    expect(column(fleetTask({ ...dispatched, dispatchStatus: "completed" }), running)).toBe("review");
    const wantsChanges = taskTeam({ review: { rounds: 1, roundsLeft: 1, attempts: [reviewAttempt()] } });
    expect(column(fleetTask({ ...dispatched, dispatchStatus: "completed", dispatchUpdatedAt: 150 }), wantsChanges)).toBe("review");
    expect(column(fleetTask({ ...dispatched, dispatchStatus: "completed", verifiedAt: 5, verifyExitCode: 0 }), taskTeam())).toBe("integrate");
    expect(column(fleetTask({ status: "passes" }), taskTeam({ integrated: true }))).toBe("done");
    expect(column(fleetTask({ status: "cancelled" }))).toBe("done");
  });

  it("sends a failed CLI turn back to writing with a red marker", () => {
    const card = deriveCard(fleetTask({ ...dispatched, dispatchStatus: "failed" }), taskTeam());
    expect([card.column, card.trouble]).toEqual(["write", "failed"]);
  });

  it("marks failed verification red and review follow-ups as attention, in their own columns", () => {
    const verify = deriveCard(fleetTask({ ...dispatched, dispatchStatus: "completed", verifiedAt: 5, verifyExitCode: 2 }), taskTeam());
    expect([verify.column, verify.trouble]).toEqual(["verify", "failed"]);
    const review = deriveCard(fleetTask({ ...dispatched, dispatchStatus: "completed", dispatchUpdatedAt: 150 }),
      taskTeam({ review: { rounds: 1, roundsLeft: 1, attempts: [reviewAttempt()] } }));
    expect([review.column, review.trouble]).toEqual(["review", "attention"]);
  });

  it("puts a hold in the owner column whatever else is true, except finished tasks", () => {
    const hold = { question: "30 or 90 days?", askedAt: 1 };
    expect(column(fleetTask({ hold }))).toBe("owner");
    expect(column(fleetTask({ ...dispatched, dispatchStatus: "running", hold }), taskTeam())).toBe("owner");
    expect(deriveCard(fleetTask({ hold }), undefined).held).toBe(true);
    expect(column(fleetTask({ status: "cancelled", hold }))).toBe("done");
    expect(deriveCard(fleetTask({ status: "passes", hold }), undefined).held).toBe(false);
  });

  it("treats a written task without verify command as integrate-ready only in its own worktree", () => {
    const written = fleetTask({ ...dispatched, dispatchStatus: "completed", verifyCommand: null });
    expect(column(written, taskTeam())).toBe("integrate");
    expect(column(written, taskTeam({ workspace: "shared", integrated: null }))).toBe("verify");
  });

  it("groups by column ordered by seq, cancelled last in done", () => {
    const board = deriveBoard([
      fleetTask({ id: "a", seq: 3, status: "cancelled" }),
      fleetTask({ id: "b", seq: 2, status: "passes" }),
      fleetTask({ id: "c", seq: 1, status: "pending" }),
      fleetTask({ id: "d", seq: 4, status: "passes" }),
    ], undefined);
    expect(board.queue.map((card) => card.task.id)).toEqual(["c"]);
    expect(board.done.map((card) => card.task.id)).toEqual(["b", "d", "a"]);
    expect(columnOf(board.done[2]!.task, board.done[2]!.flow)).toBe("done");
  });
});
