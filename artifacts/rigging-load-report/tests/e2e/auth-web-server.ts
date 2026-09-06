import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../..");
const apiPort = 4181;
const webPort = 4182;
const proxyPort = 4180;
const children: ChildProcess[] = [];
let stopping = false;

function start(
  args: string[],
  env: Record<string, string>,
): ChildProcess {
  const child = spawn("pnpm", args, {
    cwd: workspaceRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `Auth E2E service exited before teardown (code=${code}, signal=${signal}).`,
      );
      void stop(1);
    }
  });
  return child;
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const proxy = http.createServer((request, response) => {
  const isApi = request.url === "/api" || request.url?.startsWith("/api/");
  const targetPort = isApi ? apiPort : webPort;
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        host: `127.0.0.1:${targetPort}`,
      },
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain" });
    }
    response.end(`Auth E2E upstream unavailable: ${error.message}`);
  });
  request.pipe(upstream);
});

async function stop(exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  process.exit(exitCode);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function main(): Promise<void> {
  start(
    ["--filter", "@workspace/api-server", "exec", "tsx", "src/index.ts"],
    { PORT: String(apiPort), NODE_ENV: "development" },
  );
  start(
    ["--filter", "@workspace/rigging-load-report", "run", "dev"],
    { PORT: String(webPort), BASE_PATH: "/" },
  );
  await Promise.all([
    waitFor(`http://127.0.0.1:${apiPort}/api/healthz`),
    waitFor(`http://127.0.0.1:${webPort}/`),
  ]);
  proxy.listen(proxyPort, "127.0.0.1");
}

void main().catch((error) => {
  console.error(error);
  void stop(1);
});