import "./load-env";
import http from "node:http";
import { runServingRebuild } from "../src/lib/services/serving-rebuild.service";

const token = (process.env.WORKER_TOKEN ?? "").trim();
if (!token) {
  console.error("[serving-rebuild-worker] WORKER_TOKEN missing");
  process.exit(1);
}

const port = Number(process.env.PORT ?? "") || 8788;

function isAuthorized(req: http.IncomingMessage): boolean {
  const header = String(req.headers["authorization"] ?? "");
  return header === `Bearer ${token}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "POST" || req.url !== "/serve-rebuild") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }

    if (!isAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }

    const result = await runServingRebuild({ warmCaches: false });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        snapshotDate: result.snapshotDate,
        serving: result.serving,
        derived: result.derived,
        warm: result.warm,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "worker_failed", message }));
  }
});

server.listen(port, () => {
  console.info("[serving-rebuild-worker] listening", { port });
});

