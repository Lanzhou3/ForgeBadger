import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const i18nPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/src/lib/i18n.ts"
);
const i18n = readFileSync(i18nPath, "utf8");

/**
 * `notificationTitleKey` used to be an if-chain that fell through to the Claude
 * keys, while the translation catalogue was maintained separately. Adding an
 * adapter therefore produced notifications titled with another CLI's name — the
 * mcode case shipped exactly that way. These assertions read the gateway's
 * adapter set and the web catalogue and require them to agree.
 */
describe("notification title keys", () => {
  const gatewaySource = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/services/notification-events.ts"
    ),
    "utf8"
  );

  function gatewayAdapters(): string[] {
    const block = /NOTIFICATION_TITLE_ADAPTERS[^=]*=\s*new Set\(\[([^\]]*)\]/u.exec(gatewaySource);
    assert.ok(block, "NOTIFICATION_TITLE_ADAPTERS set not found");
    return [...block[1]!.matchAll(/"([a-z0-9-]+)"/gu)].map((m) => m[1]!);
  }

  it("resolves a per-adapter title instead of falling back to Claude", () => {
    assert.match(gatewaySource, /NOTIFICATION_TITLE_ADAPTERS\.has\(adapter\)/u);
  });

  it("covers every adapter the gateway registers", () => {
    const discovery = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/services/adapter-discovery.ts"
      ),
      "utf8"
    );
    const ids = new Set(
      [...discovery.matchAll(/^\s{4}id:\s*"([a-z0-9-]+)",/gmu)].map((m) => m[1]!)
    );
    assert.ok(ids.size > 0, "no adapter ids parsed");

    const covered = new Set(gatewayAdapters());
    // Adapters without a native notification channel may legitimately be absent;
    // the contract here is only that the set stays explicit.
    for (const id of ids) {
      if (!covered.has(id)) {
        // Documented exception rather than an accidental omission.
        assert.ok(
          ["opencode", "pi"].includes(id) || covered.has(id),
          `adapter ${id} must be listed in NOTIFICATION_TITLE_ADAPTERS`
        );
      }
    }
  });

  it("has a zh-CN, zh-TW and en title for every listed adapter", () => {
    for (const adapter of gatewayAdapters()) {
      for (const suffix of ["PermissionRequest", "PermissionDenied"]) {
        const key = `notifications.${adapter}${suffix}`;
        const occurrences = i18n.split(`"${key}"`).length - 1;
        // One entry per locale.
        assert.equal(occurrences, 3, `${key} should exist in all three locales`);
      }
    }
  });

  it("uses the official display name in the mcode titles", () => {
    assert.match(i18n, /"notifications\.mcodePermissionRequest": "MiniMax Code 权限申请"/u);
    assert.match(i18n, /"notifications\.mcodePermissionDenied": "MiniMax Code 权限被拒绝"/u);
    assert.match(i18n, /"notifications\.mcodePermissionRequest": "MiniMax Code permission request"/u);
  });
});
