import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import net from "net";
import crypto from "crypto";
import { execSync } from "child_process";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_PORT = env.ML_PORT;
const ML_BASE = process.env.ML_BASE_URL || `http://127.0.0.1:${ML_PORT}`;
const ML_HOST = (() => {
  try {
    const url = new URL(ML_BASE);
    return url.hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
})();
let mlReady = false;
let mlStarting = false;
let mlKeepRunning = true;
let mlProc: any = null;
let startMLTimeout: any = null;
let exitTimeout: any = null;

// Cross-platform timeout-aware AbortSignal helper
function makeTimeoutSignal(ms: number) {
  const ac = new AbortController();
  const t = setTimeout(
    () =>
      ac.abort(
        new DOMException(
          "The operation was aborted due to timeout",
          "AbortError",
        ),
      ),
    ms,
  );
  t.unref();
  return ac.signal;
}

// Uses a raw TCP connect to check if the port is open
function portUp(port: number, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createConnection(port, host);
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.setTimeout(400, () => {
      s.destroy();
      resolve(false);
    });
  });
}

// Kill any process listening on the given port using PowerShell
async function portKill(port: number) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listener = await portUp(port, "127.0.0.1");
    if (!listener) break;
    try {
      const stdout = execSync(`netstat -ano | findstr :${port}`, { timeout: 2000, encoding: "utf8" });
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0") {
          try {
            execSync(`taskkill /PID ${pid} /F`, { timeout: 2000 });
          } catch (_) {}
        }
      }
    } catch (_) {
      // Process already gone or not on Windows
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Probe ML readiness
async function mlHealthy() {
  if (!(await portUp(ML_PORT, ML_HOST))) return false;
  try {
    const r = await fetch(`${ML_BASE}/health`, {
      signal: makeTimeoutSignal(3000),
    });
    if (r.ok) {
      const j = await r.json();
      return !!(j && j.status === "ok");
    }
  } catch {
    /* Keep waiting */
  }
  return false;
}

// Upgraded ML proxy fetcher
async function mlFetch(endpoint: string, opts: Record<string, any> = {}, correlationId: string | null = null, timeoutMs: number = 15000) {
  const cid = correlationId || crypto.randomUUID();
  const url = `${ML_BASE}${endpoint}`;
  try {
    const r = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-ID": cid,
        ...(opts.headers || {}),
      },
      signal: makeTimeoutSignal(timeoutMs),
    });
    if (!r.ok) {
      const errorText = await r.text().catch(() => "");
      throw new Error(`ML service returned status ${r.status}: ${errorText}`);
    }
    return await r.json();
  } catch (e: any) {
    console.error(
      `[ML ERROR] [Correlation-ID: ${cid}] Endpoint: ${endpoint} | Error: ${e.message}`,
    );
    throw e;
  }
}

// Start Python ML service FastAPI spawner
async function startMLService() {
  if (mlStarting) return;
  mlStarting = true;
  mlKeepRunning = true;
  const python = process.env.PYTHON || "python";
  let stockwiseDir = path.join(__dirname, "..");
  if (path.basename(stockwiseDir) === "dist") {
    stockwiseDir = path.dirname(stockwiseDir);
  }

  await portKill(ML_PORT);

  if (await mlHealthy()) {
    mlReady = true;
    mlStarting = false;
    console.log(`[ML] Python service already healthy on port ${ML_PORT}`);
    return;
  }
  console.log(`[ML] Starting Python ML service on port ${ML_PORT}`);
  mlProc = spawn(python, ["ml_engine/server.py"], {
    cwd: stockwiseDir,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    windowsHide: true,
  });

  mlProc.on("error", (err: Error) => console.error("[ML] spawn error:", err.message));

  mlProc.stdout.on("data", (b: Buffer) => {
    const line = b.toString().trim();
    if (line) console.log("[ML]", line);
  });

  mlProc.stderr.on("data", (b: Buffer) => {
    const msg = b.toString().trim();
    if (msg.includes("only one usage") || msg.includes("Errno 48")) {
      console.log(`[ML] Port conflict on ${ML_PORT}, retrying in 5 s…`);
      startMLTimeout = setTimeout(startMLService, 5000);
    } else if (msg.includes("Training complete")) {
      console.log("[ML] Training complete");
    } else if (msg) {
      console.error("[ML]", msg);
    }
  });

  mlProc.on("exit", () => {
    if (!mlKeepRunning) return;
    console.error("[ML] Process exited — restarting in 3 s");
    mlReady = false;
    mlStarting = false;
    exitTimeout = setTimeout(startMLService, 3000);
  });

  (async function healthPoll() {
    while (mlKeepRunning && mlProc && mlProc.exitCode === null) {
      if (await mlHealthy()) {
        mlReady = true;
        mlStarting = false;
        console.log(`[ML] Python service healthy on port ${ML_PORT}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  })();
}

function stopMLService() {
  mlKeepRunning = false;
  mlReady = false;
  mlStarting = false;
  if (startMLTimeout) {
    clearTimeout(startMLTimeout);
    startMLTimeout = null;
  }
  if (exitTimeout) {
    clearTimeout(exitTimeout);
    exitTimeout = null;
  }
  if (mlProc) {
    mlProc.removeAllListeners("exit");
    mlProc.removeAllListeners("error");
    try {
      mlProc.kill();
    } catch (e: any) {}
    mlProc = null;
  }
}

function isMlReady() {
  return mlReady;
}
function setMlReady(val: boolean) {
  mlReady = val;
}

export default {
  ML_PORT,
  ML_BASE,
  isMlReady: () => mlReady,
  setMlReady: (val: boolean) => {
    mlReady = val;
  },
  mlHealthy,
  mlFetch,
  startMLService,
  stopMLService,
};
