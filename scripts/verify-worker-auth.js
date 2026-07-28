const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

const port = 39002;
const secret = randomBytes(32).toString('base64url');
const worker = spawn(process.execPath, ['worker/src/server.js'], {
  cwd: resolve(__dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HMO_WORKER_SHARED_SECRET: secret,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stderr = '';
let stdout = '';
worker.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
worker.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.status;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Worker did not become healthy (exit=${worker.exitCode}): ${(stderr || stdout).slice(-1000)}`);
}

async function run() {
  const health = await waitForHealth();
  const unauthorized = await fetch(`http://127.0.0.1:${port}/dj`);
  const authorized = await fetch(`http://127.0.0.1:${port}/dj`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (unauthorized.status !== 401) {
    throw new Error(`Expected unauthenticated /dj to return 401, received ${unauthorized.status}`);
  }
  if (authorized.status !== 200) {
    throw new Error(`Expected authenticated /dj to return 200, received ${authorized.status}`);
  }

  process.stdout.write(`${JSON.stringify({ health, unauthorized: unauthorized.status, authorized: authorized.status })}\n`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    worker.kill();
  });
