import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGatewayBaseUrl } from "./runtime-config";

const ORIGINAL_GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL;

describe("getGatewayBaseUrl", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_GATEWAY_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_GATEWAY_URL === undefined) {
      delete process.env.NEXT_PUBLIC_GATEWAY_URL;
    } else {
      process.env.NEXT_PUBLIC_GATEWAY_URL = ORIGINAL_GATEWAY_URL;
    }
  });

  it("uses the browser runtime gateway URL when present", () => {
    vi.stubGlobal("window", {
      __FORGEBADGER_RUNTIME__: {
        gatewayBaseUrl: "http://runtime.example:18332",
      },
    });
    process.env.NEXT_PUBLIC_GATEWAY_URL = "http://env.example:18332";

    expect(getGatewayBaseUrl()).toBe("http://runtime.example:18332");
  });

  it("falls back to the default gateway URL", () => {
    expect(getGatewayBaseUrl()).toBe("http://127.0.0.1:18332");
  });

  it("ignores an empty browser runtime gateway URL", () => {
    vi.stubGlobal("window", {
      __FORGEBADGER_RUNTIME__: {
        gatewayBaseUrl: " ",
      },
    });
    process.env.NEXT_PUBLIC_GATEWAY_URL = "http://env.example:18332";

    expect(getGatewayBaseUrl()).toBe("http://env.example:18332");
  });

  it("lets the env override win in development, where the placeholder runtime config is served", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      vi.stubGlobal("window", {
        __FORGEBADGER_RUNTIME__: {
          gatewayBaseUrl: "http://runtime.example:18332",
        },
      });
      process.env.NEXT_PUBLIC_GATEWAY_URL = "http://env.example:18332";

      expect(getGatewayBaseUrl()).toBe("http://env.example:18332");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the runtime config winning outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      vi.stubGlobal("window", {
        __FORGEBADGER_RUNTIME__: {
          gatewayBaseUrl: "http://runtime.example:18332",
        },
      });
      process.env.NEXT_PUBLIC_GATEWAY_URL = "http://env.example:18332";

      expect(getGatewayBaseUrl()).toBe("http://runtime.example:18332");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
