import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT ?? 8787);
const ttlMs = 60_000;
const maxBodyBytes = 256 * 1024;
const codes = new Map();

const server = http.createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'POST' && url.pathname.startsWith('/mobile-auth/store/')) {
      await handleStorePath(request, response, decodeURIComponent(url.pathname.replace('/mobile-auth/store/', '')));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/mobile-auth/store') {
      await handleLegacyStore(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/mobile-auth/exchange/')) {
      const [, state = '', code = ''] =
        url.pathname.match(/^\/mobile-auth\/exchange\/([^/]+)\/([^/]+)$/)?.map(decodeURIComponent) ?? [];
      await handleExchangePath(response, { code, state });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/mobile-auth/exchange') {
      await handleLegacyExchange(request, response);
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/mobile-auth' || url.pathname === '/mobile-auth/')) {
      await serveFile(response, path.join(distDir, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/mobile-auth/')) {
      const relativePath = url.pathname.replace(/^\/mobile-auth\/?/, '');
      const filePath = path.normalize(path.join(distDir, relativePath));

      if (!filePath.startsWith(distDir)) {
        writeJson(response, 403, { error: 'Forbidden' });
        return;
      }

      await serveFile(response, filePath, contentTypeFor(filePath));
      return;
    }

    writeJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, 500, { error: message });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Mobile auth server listening on http://localhost:${port}/mobile-auth`);
  for (const address of getLanAddresses()) {
    console.log(`LAN device URL: http://${address}:${port}/mobile-auth`);
  }
});

setInterval(cleanupExpiredCodes, ttlMs).unref();

async function handleStorePath(request, response, state) {
  const delegationText = await readTextBody(request);

  if (state.length < 32 || !delegationText.trim().startsWith('{')) {
    writeJson(response, 400, { error: 'Invalid delegation store request' });
    return;
  }

  const code = crypto.randomBytes(32).toString('hex');
  codes.set(code, {
    state,
    delegation: JSON.parse(delegationText),
    expiresAt: Date.now() + ttlMs
  });

  writeJson(response, 200, { code, expiresInSeconds: ttlMs / 1000 });
}

async function handleLegacyStore(request, response) {
  const body = await readJsonBody(request);
  const state = typeof body.state === 'string' ? body.state : '';

  if (state.length < 32 || !body.delegation || typeof body.delegation !== 'object') {
    writeJson(response, 400, { error: 'Invalid delegation store request' });
    return;
  }

  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(code, {
    state,
    delegation: body.delegation,
    expiresAt: Date.now() + ttlMs
  });

  writeJson(response, 200, { code, expiresInSeconds: ttlMs / 1000 });
}

async function handleLegacyExchange(request, response) {
  const body = await readJsonBody(request);
  const code = typeof body.code === 'string' ? body.code : '';
  const state = typeof body.state === 'string' ? body.state : '';
  await handleExchangePath(response, { code, state });
}

async function handleExchangePath(response, { code, state }) {
  const record = codes.get(code);

  if (!record) {
    writeJson(response, 404, { error: 'Unknown or already used code' });
    return;
  }

  codes.delete(code);

  if (record.expiresAt <= Date.now()) {
    writeJson(response, 410, { error: 'Code expired' });
    return;
  }

  if (record.state !== state) {
    writeJson(response, 400, { error: 'State mismatch' });
    return;
  }

  writeJson(response, 200, { delegation: record.delegation });
}

function cleanupExpiredCodes() {
  const now = Date.now();
  for (const [code, record] of codes.entries()) {
    if (record.expiresAt <= now) {
      codes.delete(code);
    }
  }
}

async function readJsonBody(request) {
  return JSON.parse(await readTextBody(request));
}

async function readTextBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new Error('Request body is too large');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function serveFile(response, filePath, contentType) {
  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': contentType.includes('html') ? 'no-store' : 'public, max-age=31536000, immutable'
    });
    response.end(file);
  } catch {
    if (filePath.endsWith('index.html')) {
      writeJson(response, 503, {
        error: 'mobile-auth/dist is missing. Run npm run build:mobile-auth before npm run auth:server.'
      });
      return;
    }

    writeJson(response, 404, { error: 'Not found' });
  }
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function setSecurityHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}
