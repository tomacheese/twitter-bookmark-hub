import path from "node:path";
import { serve } from "@hono/node-server";
import { Logger } from "@book000/node-utils";
import { createServer } from "./server";
import { openDatabase } from "./infra/database";
import { initTokenizer } from "./core/tagger";

const logger = Logger.configure("main");

const dataDir = process.env.DATA_DIR ?? "/data";
const port = Number(process.env.ANALYZER_PORT ?? "3002");
const dbPath = path.join(dataDir, "db.sqlite");

logger.info(`Initializing database at ${dbPath}...`);
const db = openDatabase(dbPath);

logger.info("Initializing kuromoji tokenizer...");
initTokenizer()
  .then((tokenizer) => {
    logger.info("Tokenizer ready.");
    const app = createServer(db, tokenizer);
    logger.info(`Starting HTTP server on port ${port}...`);
    serve({ fetch: app.fetch, port });
  })
  .catch((error: unknown) => {
    logger.error(
      "Failed to initialize tokenizer:",
      error instanceof Error ? error : new Error(String(error)),
    );
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  });
