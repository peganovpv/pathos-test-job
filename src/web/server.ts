import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import express, { type Express, type Request, type Response } from "express";
import { ConfigError, DEFAULT_THRESHOLDS, loadThresholds, type Thresholds } from "../config.js";
import { AnthropicJudge } from "../llm/anthropic.js";
import { JudgeError, MissingCredentialError } from "../llm/port.js";
import { grade } from "../score.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_DRAFT_BYTES = 200_000;
const DEFAULT_PORT = 3000;

export interface AppOptions {
  thresholds?: Thresholds;
  /** Forces every request to skip the model call, whatever the client asks for. */
  offlineOnly?: boolean;
}

function thresholdsFromCwd(): Thresholds {
  const path = resolve(process.cwd(), "prq.config.json");
  return existsSync(path) ? loadThresholds(path) : DEFAULT_THRESHOLDS;
}

export function createApp(options: AppOptions = {}): Express {
  const thresholds = options.thresholds ?? thresholdsFromCwd();
  const app = express();

  app.use(express.json({ limit: MAX_DRAFT_BYTES }));
  app.get("/", (_request, response: Response) => {
    response.sendFile(resolve(HERE, "index.html"));
  });

  app.post("/api/check", async (request: Request, response: Response) => {
    const body = request.body as { draft?: unknown; offline?: unknown };

    if (typeof body.draft !== "string" || body.draft.trim().length === 0) {
      response.status(400).json({ error: "Paste a draft press release first." });
      return;
    }

    const offline = options.offlineOnly === true || body.offline === true;

    try {
      const report = await grade(body.draft, {
        judge: offline ? null : new AnthropicJudge(),
        thresholds,
      });
      response.json({ ...report, offline });
    } catch (error) {
      if (error instanceof MissingCredentialError) {
        response.status(503).json({ error: error.message });
        return;
      }
      if (error instanceof JudgeError) {
        response.status(502).json({ error: error.message });
        return;
      }
      response.status(500).json({ error: "Something went wrong scoring that draft." });
    }
  });

  return app;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  let thresholds: Thresholds;
  try {
    thresholds = thresholdsFromCwd();
  } catch (error) {
    process.stderr.write(`prq: ${error instanceof ConfigError ? error.message : String(error)}\n`);
    process.exit(2);
  }

  const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
  createApp({ thresholds }).listen(port, () => {
    process.stdout.write(`prq is listening on http://localhost:${port}\n`);
  });
}
