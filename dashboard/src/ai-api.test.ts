import { type AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import process from "node:process";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildGroundedInput, handleAiApi } from "../ai-api";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;

describe("AI analyst API configuration", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (!(await handleAiApi(request, response, url))) {
          response.writeHead(404).end();
        }
      })().catch((error: unknown) => {
        response.writeHead(500).end(error instanceof Error ? error.message : String(error));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  afterAll(async () => {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("reports an unconfigured OpenAI integration without exposing a secret", async () => {
    const response = await fetch(`${baseUrl}/api/ai/status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: false,
      provider: "openai",
      model: "gpt-5.6-sol",
    });
  });

  it("reports a configured model override independently of the API key", async () => {
    process.env.OPENAI_MODEL = "custom-analysis-model";

    const response = await fetch(`${baseUrl}/api/ai/status`);

    expect(await response.json()).toEqual({
      configured: false,
      provider: "openai",
      model: "custom-analysis-model",
    });
  });

  it("returns setup guidance when chat is called without a key", async () => {
    const response = await fetch(`${baseUrl}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Analyze this" }] }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AI is not configured. Add OPENAI_API_KEY to .env and restart the dashboard.",
    });
  });

  it("rejects unsupported methods", async () => {
    const response = await fetch(`${baseUrl}/api/ai/status`, { method: "POST" });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  });
});

describe("AI analyst grounding", () => {
  it("places the newest snapshot immediately before the latest question", () => {
    const input = buildGroundedInput(
      [
        { role: "user", content: "First question" },
        { role: "assistant", content: "Answer based on old filters" },
        { role: "user", content: "What about now?" },
      ],
      '{"snapshot":"current"}',
    );

    expect(input.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "developer",
      "user",
    ]);
    expect(input[2]?.content).toContain('{"snapshot":"current"}');
    expect(input[3]?.content).toBe("What about now?");
  });
});
