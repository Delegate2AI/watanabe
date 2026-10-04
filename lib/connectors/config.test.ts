import { afterEach, describe, expect, it } from "vitest";
import { isConnectorOauthEnabled, isConnectorsEnabled } from "./config";

afterEach(() => {
  delete process.env.CONNECTORS_ENABLED;
  delete process.env.CONNECTOR_OAUTH_ENABLED;
});

describe("isConnectorsEnabled", () => {
  it("is false by default", () => {
    expect(isConnectorsEnabled()).toBe(false);
  });

  it("is true when CONNECTORS_ENABLED=1", () => {
    process.env.CONNECTORS_ENABLED = "1";
    expect(isConnectorsEnabled()).toBe(true);
  });
});

describe("isConnectorOauthEnabled", () => {
  it("is false when both flags are off", () => {
    expect(isConnectorOauthEnabled()).toBe(false);
  });

  it("is false when CONNECTOR_OAUTH_ENABLED=1 but CONNECTORS_ENABLED is off", () => {
    process.env.CONNECTOR_OAUTH_ENABLED = "1";
    expect(isConnectorOauthEnabled()).toBe(false);
  });

  it("is false when CONNECTORS_ENABLED=1 but CONNECTOR_OAUTH_ENABLED is off", () => {
    process.env.CONNECTORS_ENABLED = "1";
    expect(isConnectorOauthEnabled()).toBe(false);
  });

  it("is true only when both CONNECTORS_ENABLED=1 and CONNECTOR_OAUTH_ENABLED=1", () => {
    process.env.CONNECTORS_ENABLED = "1";
    process.env.CONNECTOR_OAUTH_ENABLED = "1";
    expect(isConnectorOauthEnabled()).toBe(true);
  });
});
