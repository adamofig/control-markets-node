#!/usr/bin/env node

/**
 * CLI Helper to send agent messages in Control Markets
 * Usage:
 *   node scripts/send-agent-message.js --agent zazu --to adamo.figueroa@gmail.com --text "Hola Adamo!"
 *   pnpm send:agent-message --agent zazu --to adamo.figueroa@gmail.com --text "Hola Adamo!"
 */

const fs = require('fs');
const path = require('path');

// Pre-configured Agentic Profile Aliases for Dev environment
const KNOWN_AGENTS = {
  zazu: '6a6e5c9a6bf9cbb98d96cda9',
  borges: '6a2aee5dca1c5b4116588897',
};

// Known Org Aliases for Dev
const KNOWN_ORGS = {
  dev: '6a27c95e18f26467e443f298',
  'control-markets-dev': '6a27c95e18f26467e443f298',
  polilan: '6923e6b904f03ae5952d5fb7',
};

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '../.env'),
    path.join(__dirname, '../.env'),
    path.join(__dirname, '../../.env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, ...vals] = trimmed.split('=');
          const val = vals.join('=').trim().replace(/^["']|["']$/g, '');
          if (key.trim() && !process.env[key.trim()]) {
            process.env[key.trim()] = val;
          }
        }
      }
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    agent: 'zazu',
    to: 'adamo.figueroa@gmail.com',
    text: '',
    org: '6a27c95e18f26467e443f298',
    url: process.env.CONTROL_MARKETS_NODE_URL || 'http://localhost:8121',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent' || arg === '-a') options.agent = args[++i];
    else if (arg === '--to' || arg === '-t') options.to = args[++i];
    else if (arg === '--text' || arg === '--message' || arg === '-m') options.text = args[++i];
    else if (arg === '--org' || arg === '-o') options.org = args[++i];
    else if (arg === '--url' || arg === '-u') options.url = args[++i];
    else if (!options.text && !arg.startsWith('-')) options.text = arg;
  }

  return options;
}

async function run() {
  loadEnv();

  const options = parseArgs();
  const patToken = process.env.CONTROL_MARKETS_PAT || 'cm_pat_mq7jkspr4b615';

  if (!options.text) {
    console.error('Error: Message text is required. Usage: node scripts/send-agent-message.js --agent zazu --to user@email.com --text "Hello"');
    process.exit(1);
  }

  const agenticProfileId = KNOWN_AGENTS[options.agent.toLowerCase()] || options.agent;
  const orgId = KNOWN_ORGS[options.org.toLowerCase()] || options.org;
  const targetUserIdentifier = options.to;

  const endpoint = `${options.url.replace(/\/$/, '')}/api/inbox/agents/${agenticProfileId}/messages`;

  console.log(`\n🦜 Zazu Agent Message Dispatcher`);
  console.log(`-----------------------------------`);
  console.log(`Endpoint:    ${endpoint}`);
  console.log(`Agent Profile: ${options.agent} (${agenticProfileId})`);
  console.log(`Recipient:   ${targetUserIdentifier} (Email or User ID)`);
  console.log(`Org ID:      ${orgId}`);
  console.log(`PAT Source:  ${process.env.CONTROL_MARKETS_PAT ? '.env (CONTROL_MARKETS_PAT)' : 'Default Fallback'}`);
  console.log(`-----------------------------------\n`);

  const payload = {
    targetUserId: targetUserIdentifier, // Accepts both Email and User ID!
    clientMessageId: `cli-msg-${Date.now()}`,
    parts: [
      {
        type: 'text',
        text: options.text,
        format: 'markdown',
        language: 'es',
      },
    ],
    source: {
      type: 'local',
      engine: 'claude',
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${patToken}`,
      'X-Org-Id': orgId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const statusCode = response.status;
  const data = await response.json();

  if (statusCode >= 200 && statusCode < 300) {
    console.log(`✅ Message delivered successfully! (HTTP ${statusCode})`);
    console.log(`   Message ID:      ${data?.message?.id}`);
    console.log(`   Conversation ID: ${data?.message?.conversationId}`);
    console.log(`   Sender:          ${data?.message?.senderParticipantId}`);
    console.log(`   Sequence:        ${data?.message?.sequence}\n`);
  } else {
    console.error(`❌ Failed to send message (HTTP ${statusCode}):`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
