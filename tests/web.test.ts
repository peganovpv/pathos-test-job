import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/web/server.js";
import { loadFixture } from "./fixtures.test.js";

let server: Server;
let base: string;

/** offlineOnly pins the server to the deterministic path, so no test can reach the network. */
beforeAll(async () => {
  await new Promise<void>((done) => {
    server = createApp({ offlineOnly: true }).listen(0, () => done());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function check(body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}/api/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe("GET /", () => {
  it("serves the page", async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Press release quality check");
    expect(html).toContain('id="draft"');
  });
});

describe("POST /api/check", () => {
  it("returns the same score the CLI produces for the same draft", async () => {
    const { status, json } = await check({ draft: loadFixture("strong") });
    expect(status).toBe(200);
    expect(json.overall).toBe(100);
    expect(json.band).toBe("ready");
    expect(json.offline).toBe(true);
  });

  it("discriminates between drafts", async () => {
    const strong = await check({ draft: loadFixture("strong") });
    const weak = await check({ draft: loadFixture("weak") });
    expect(weak.json.overall).toBeLessThan(strong.json.overall);
    expect(weak.json.band).toBe("rewrite");
  });

  it("returns the findings the page renders", async () => {
    const { json } = await check({ draft: loadFixture("weak") });
    expect(json.topFixes.length).toBeGreaterThan(5);
    expect(json.topFixes[0]).toHaveProperty("severity");
    expect(json.topFixes[0]).toHaveProperty("message");
    expect(json.facts).toHaveProperty("newsWords");
  });

  it.each([
    ["a missing draft", {}],
    ["an empty draft", { draft: "   \n  " }],
    ["a non-string draft", { draft: 42 }],
  ])("rejects %s with 400", async (_label, body) => {
    const { status, json } = await check(body);
    expect(status).toBe(400);
    expect(json.error).toMatch(/Paste a draft/);
  });

  it("honours offlineOnly even when the client asks for a model call", async () => {
    const { json } = await check({ draft: loadFixture("strong"), offline: false });
    expect(json.offline).toBe(true);
    expect(json.skipped).toEqual(["newsworthiness", "quoteability"]);
  });
});
