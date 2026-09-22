// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teamsApi, accountsApi } from "./teams-api";
import { register } from "./api";
import {
  collaborationApi,
  hasCapability,
  secureCredentialTransport,
} from "./collaboration-api";
const request = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", request);
  request.mockReset();
  request.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    ),
  );
  localStorage.setItem("forgebadger.token", "session");
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("sends invite secrets only in authenticated or public POST bodies, never URLs", async () => {
  await teamsApi.inspect("secret");
  await teamsApi.register("secret", "new@example.com", "password");
  await teamsApi.accept("secret");
  for (const [url, options] of request.mock.calls) {
    expect(url).not.toContain("secret");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body).token).toBe("secret");
  }
});
it("sends member, team and project revision guards for authority mutations", async () => {
  await teamsApi.member("team/1", "member/1", "admin", 4);
  await teamsApi.transfer("t", "m", 9);
  await teamsApi.enroll("t", "p", 7, 9);
  expect(request.mock.calls[0]![0]).toContain(
    "/teams/team%2F1/members/member%2F1",
  );
  expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({
    role: "admin",
    expectedRevision: 4,
  });
  expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({
    newOwnerId: "m",
    expectedRevision: 9,
  });
  expect(JSON.parse(request.mock.calls[2]![1].body)).toEqual({
    projectId: "p",
    expectedProjectRevision: 7,
    expectedTeamRevision: 9,
  });
});
it("passes ordinary registration invite code and account password reset through the existing API", async () => {
  await register("local@example.com", "password", "recovery", "invite");
  await accountsApi.reset("user/1", "replacement");
  expect(JSON.parse(request.mock.calls[0]![1].body).inviteCode).toBe("invite");
  expect(request.mock.calls[1]![0]).toContain(
    "/admin/users/user%2F1/reset-password",
  );
  expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({
    password: "replacement",
  });
});
it("does not infer development or review from an owner-like role when capabilities are present", () => {
  const manager = { role: "owner" as const, capabilities: ["read", "manage"] };
  expect(hasCapability(manager, "develop")).toBe(false);
  expect(hasCapability(manager, "review")).toBe(false);
  expect(hasCapability(manager, "manage")).toBe(true);
  expect(hasCapability({ role: "owner", capabilities: [] }, "manage")).toBe(
    false,
  );
});
it("sends reconciliation expected HEAD and stable request identity", async () => {
  await collaborationApi.reconcile("p", "r", "head", "stable-key");
  expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({
    expectedCommit: "head",
    idempotencyKey: "stable-key",
  });
});
it("refuses credential transport through remote HTTP even if the other endpoint is secure", () => {
  expect(
    secureCredentialTransport(
      "http://127.0.0.1:48731",
      "http://localhost:48732",
    ),
  ).toBe(true);
  expect(
    secureCredentialTransport("https://gateway.example", "https://web.example"),
  ).toBe(true);
  expect(
    secureCredentialTransport("http://192.168.1.2:3000", "https://web.example"),
  ).toBe(false);
  expect(
    secureCredentialTransport(
      "https://gateway.example",
      "http://private.example",
    ),
  ).toBe(false);
  expect(
    secureCredentialTransport(
      "http://localhost.evil.invalid",
      "http://localhost",
    ),
  ).toBe(false);
});
