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
      __OPENFORGE_RUNTIME__: {
        gatewayBaseUrl: "http://runtime.example:48731",
      },
    });
    process.env.NEXT_PUBLIC_GATEWAY_URL = "http://env.example:48731";

    expect(getGatewayBaseUrl()).toBe("http://runtime.example:48731");
  });

  it("falls back to the default gateway URL", () => {
    expect(getGatewayBaseUrl()).toBe("http://127.0.0.1:48731");
  });

  it("ignores an empty browser runtime gateway URL", () => {
    vi.stubGlobal("window", {
      __OPENFORGE_RUNTIME__: {
        gatewayBaseUrl: " ",
      },
    });
    process.env.NEXT_PUBLIC_GATEWAY_URL = "http://env.example:48731";

    expect(getGatewayBaseUrl()).toBe("http://env.example:48731");
  });
});
