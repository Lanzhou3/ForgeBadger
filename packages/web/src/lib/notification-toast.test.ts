import { describe, expect, it } from "vitest";

import { toastDurationFor, toastToneFor } from "./notification-toast";

describe("notification toast", () => {
  describe("toastDurationFor", () => {
    it("uses a long duration for permission prompts", () => {
      expect(toastDurationFor("permission_prompt")).toBe(12000);
    });

    it("uses the default duration for other notification types", () => {
      expect(toastDurationFor("adapter_terminated")).toBe(5000);
    });

    it("uses the default duration when no notification type is present", () => {
      expect(toastDurationFor(undefined)).toBe(5000);
    });
  });

  describe("toastToneFor", () => {
    it("maps permission prompts to warning", () => {
      expect(toastToneFor("permission_prompt", { type: "claude_notification" })).toBe("warning");
    });

    it("maps completed and errored sessions to success and error", () => {
      expect(
        toastToneFor(undefined, { type: "session_status_changed", payload: { new_status: "completed" } })
      ).toBe("success");
      expect(
        toastToneFor(undefined, { type: "session_status_changed", payload: { new_status: "error" } })
      ).toBe("error");
    });

    it("maps gateway error events to error and everything else to info", () => {
      expect(toastToneFor(undefined, { type: "error" })).toBe("error");
      expect(toastToneFor(undefined, { type: "session_created" })).toBe("info");
    });
  });
});
