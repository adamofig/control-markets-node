#!/usr/bin/env node
/**
 * cm-mcp-stdio — an MCP stdio server that is really a proxy to Control Markets' own `/mcp`.
 *
 * ## Why this file exists
 *
 * Every other ACP engine takes an `mcpServers` descriptor on `session/new` and understands the
 * protocol's HTTP transport, headers included. `agy` does not: measured on 2026-08-18 against the
 * installed CLI, it has no MCP flag, its ACP adapter never mentions MCP, and its own configuration
 * knows two transports — a local `command`, and a bare `serverUrl` with nowhere to put an
 * `Authorization` header. A server we cannot authenticate to is not a server we can expose.
 *
 * So the shim: `agy` spawns this as a plain stdio MCP server, and this speaks Streamable HTTP to
 * `CM_MCP_URL` carrying `CM_MCP_TOKEN`. Same pattern, same reasoning, as the transcript reader of
 * CM-P7 — when the CLI has no channel for something, give it to it from the side rather than wait.
 *
 * ## Where the credential comes from, and why that is per-session
 *
 * `agy`'s MCP config is one global file for the whole host, so it cannot hold a per-session secret
 * and this file never reads one from disk. The token arrives in the environment, and the environment
 * is per-process: the backend spawns the ACP adapter with the session's token, the adapter spawns
 * `agy` for the turn, and `agy` spawns this shim as its own child. Verified end to end — two
 * concurrent sessions get two different tokens through one shared config entry.
 *
 * No dependencies, deliberately, so it can run under whatever Node `agy` happens to inherit.
 */

import { createInterface } from 'node:readline';

const URL_ = process.env.CM_MCP_URL || 'http://127.0.0.1:8121/mcp';
const TOKEN = process.env.CM_MCP_TOKEN || '';
const DEBUG = process.env.CM_MCP_DEBUG === 'true';

/** The MCP session id the server hands out on `initialize`; every later request must echo it. */
let mcpSessionId = null;

const log = (...args) => {
  // stdout is the protocol channel — anything that is not a JSON-RPC message must go to stderr.
  if (DEBUG) process.stderr.write(`[cm-mcp-stdio] ${args.join(' ')}\n`);
};

const send = message => process.stdout.write(JSON.stringify(message) + '\n');

/** JSON-RPC error for a transport failure, so the model reads a reason instead of a hang. */
const failure = (id, message) => ({ jsonrpc: '2.0', id, error: { code: -32000, message } });

/**
 * Parses a Streamable HTTP response body.
 *
 * The server runs with `enableJsonResponse: false`, so a reply arrives as `text/event-stream` even
 * for a single request/response pair. Both shapes are handled because the server-side flag is
 * configuration, not contract, and a proxy that breaks when it flips would be a trap.
 */
async function parseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!text) return [];
  if (contentType.includes('text/event-stream')) {
    return text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean)
      .map(payload => {
        try {
          return JSON.parse(payload);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function forward(message) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId;

  const response = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(message) });

  // Captured from the `initialize` response and echoed on everything after it; the server runs
  // stateful (`statelessMode: false`) and refuses a request that does not carry it.
  const issued = response.headers.get('mcp-session-id');
  if (issued) mcpSessionId = issued;

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    // 401 is the expected end of a long session: the ephemeral token outlived its TTL. Saying so
    // beats a generic failure, because the agent can report something true to whoever reads the run.
    const reason =
      response.status === 401
        ? 'Control Markets rejected this agent session token (expired or revoked). Ask the user to reopen the session.'
        : `Control Markets MCP returned ${response.status}: ${detail}`;
    throw new Error(reason);
  }

  return parseBody(response);
}

const rl = createInterface({ input: process.stdin });

rl.on('line', async line => {
  const raw = line.trim();
  if (!raw) return;

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    log('unparseable line, ignored');
    return;
  }

  // A notification has no id and expects no reply; forward it and stay quiet either way.
  const isNotification = message.id === undefined || message.id === null;

  try {
    const replies = await forward(message);
    for (const reply of replies) {
      // Filter out anything that is not an answer to this request — a stateful stream can carry
      // server-initiated messages the caller never asked for.
      if (isNotification && reply.id === undefined) continue;
      send(reply);
    }
  } catch (error) {
    log('forward failed:', error.message);
    if (!isNotification) send(failure(message.id, error.message));
  }
});

rl.on('close', () => process.exit(0));

if (!TOKEN) {
  log('starting WITHOUT CM_MCP_TOKEN — every call will be refused by the server (this is the safe failure, not a bug)');
}
log(`proxying to ${URL_}`);
