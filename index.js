'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const AuthService = require('./services/AuthService');
const BotWorker   = require('./core/BotWorker');
const Database    = require('./utils/Database');

// ─── Startup Checks ──────────────────────────────────────────────────────────
if (!process.env.ENCRYPTION_KEY) {
  throw new Error('[FATAL] ENCRYPTION_KEY is not set in your .env file.');
}
if (process.env.ENCRYPTION_KEY.length < 32) {
  throw new Error('[FATAL] ENCRYPTION_KEY must be at least 32 characters long.');
}
if (!process.env.DISCORD_TOKEN) {
  throw new Error('[FATAL] DISCORD_TOKEN is not set in your .env file.');
}
if (!process.env.OWNER_ID) {
  throw new Error('[FATAL] OWNER_ID is not set in your .env file.');
}

// ─── Controller State ────────────────────────────────────────────────────────
/** @type {Map<string, BotWorker>} discordUserId → BotWorker */
const workerMap = new Map();

const db     = new Database();
const authSvc = new AuthService();

// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isOwner      = (id) => id === process.env.OWNER_ID;
const isAuthed     = (id) => {
  const data = db.get('authedUsers') || [];
  return isOwner(id) || data.includes(id);
};
const reply        = (msg, text) => msg.reply({ content: text, allowedMentions: { repliedUser: false } });
const workerKey    = (userId, mcUuid) => `${userId}::${mcUuid}`;

// ─── Command Handlers ─────────────────────────────────────────────────────────

/**
 * !adduser @mention  — Owner only
 * Whitelists a Discord user so they can use !addbot.
 */
async function cmdAddUser(msg) {
  if (!isOwner(msg.author.id)) return reply(msg, '🚫 Only the bot owner can use this command.');
  const target = msg.mentions.users.first();
  if (!target) return reply(msg, '⚠️ Please mention a user: `!adduser @User`');

  const authedUsers = db.get('authedUsers') || [];
  if (authedUsers.includes(target.id)) {
    return reply(msg, `ℹ️ ${target.tag} is already whitelisted.`);
  }
  authedUsers.push(target.id);
  db.set('authedUsers', authedUsers);
  return reply(msg, `✅ ${target.tag} has been whitelisted. They can now use \`!addbot\`.`);
}

/**
 * !addbot — Authed users only
 * Starts Microsoft Device Code login flow for the requesting user.
 */
async function cmdAddBot(msg) {
  if (!isAuthed(msg.author.id)) return reply(msg, '🚫 You are not whitelisted. Ask the owner to run `!adduser @you`.');

  await reply(msg, '🔐 Starting Microsoft login — check your DMs for the device code!');

  try {
    const dmChannel = await msg.author.createDM();
    const session   = await authSvc.startDeviceCodeFlow(async (userCode, verificationUri) => {
      await dmChannel.send(
        `**Microsoft Login Required**\n\n` +
        `1. Go to: <${verificationUri}>\n` +
        `2. Enter code: \`${userCode}\`\n\n` +
        `⏳ Waiting for you to complete login…`
      );
    });

    // Encrypt & persist session
    const sessions    = db.get('sessions') || {};
    const workerKeyId = workerKey(msg.author.id, session.mcProfile.id);
    sessions[workerKeyId] = {
      discordUserId: msg.author.id,
      mcProfile:     session.mcProfile,
      encrypted:     authSvc.encryptSession({
        accessToken:  session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt:    session.expiresAt,
      }),
      autoReconnect: true,
    };
    db.set('sessions', sessions);

    await dmChannel.send(`✅ Logged in as **${session.mcProfile.name}**! Use \`!list\` to see your bots.`);
    await spawnWorker(workerKeyId, sessions[workerKeyId]);
  } catch (err) {
    console.error('[addbot] Error:', err);
    await reply(msg, `❌ Login failed: ${err.message}`);
  }
}

/**
 * !list — Lists bots owned by caller (owner sees all)
 */
async function cmdList(msg) {
  if (!isAuthed(msg.author.id)) return reply(msg, '🚫 You are not whitelisted.');
  const sessions = db.get('sessions') || {};
  const entries  = Object.entries(sessions).filter(([key, val]) =>
    isOwner(msg.author.id) ? true : val.discordUserId === msg.author.id
  );

  if (!entries.length) return reply(msg, 'ℹ️ No bots registered yet.');

  const lines = entries.map(([key, val]) => {
    const worker = workerMap.get(key);
    const status = worker ? (worker.isConnected ? '🟢 Online' : '🔴 Offline') : '⚫ Not running';
    return `• **${val.mcProfile.name}** (${val.discordUserId}) — ${status}`;
  });

  return reply(msg, `**Registered Bots:**\n${lines.join('\n')}`);
}

/**
 * !status — Shows health/hunger/location for caller's bots
 */
async function cmdStatus(msg) {
  if (!isAuthed(msg.author.id)) return reply(msg, '🚫 You are not whitelisted.');
  const sessions = db.get('sessions') || {};
  const owned    = Object.entries(sessions).filter(([, v]) =>
    isOwner(msg.author.id) ? true : v.discordUserId === msg.author.id
  );

  if (!owned.length) return reply(msg, 'ℹ️ You have no registered bots.');

  const lines = owned.map(([key, val]) => {
    const worker = workerMap.get(key);
    if (!worker || !worker.isConnected) {
      return `**${val.mcProfile.name}**: ⚫ Not connected`;
    }
    const s = worker.getStatus();
    return (
      `**${val.mcProfile.name}**\n` +
      `  ❤️ Health: ${s.health}/20  🍗 Food: ${s.food}/20\n` +
      `  📍 World: ${s.dimension} @ (${s.x}, ${s.y}, ${s.z})`
    );
  });

  return reply(msg, lines.join('\n\n'));
}

/**
 * !autoreconnect <on|off>
 */
async function cmdAutoReconnect(msg, args) {
  if (!isAuthed(msg.author.id)) return reply(msg, '🚫 You are not whitelisted.');
  const toggle = args[1]?.toLowerCase();
  if (!['on', 'off'].includes(toggle)) return reply(msg, '⚠️ Usage: `!autoreconnect on` or `!autoreconnect off`');

  const enabled  = toggle === 'on';
  const sessions = db.get('sessions') || {};
  let   changed  = 0;

  for (const [key, val] of Object.entries(sessions)) {
    if (val.discordUserId === msg.author.id) {
      sessions[key].autoReconnect = enabled;
      const worker = workerMap.get(key);
      if (worker) worker.autoReconnect = enabled;
      changed++;
    }
  }

  if (!changed) return reply(msg, 'ℹ️ You have no registered bots.');
  db.set('sessions', sessions);
  return reply(msg, `✅ Auto-reconnect **${toggle.toUpperCase()}** for all your bots.`);
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────────────

async function spawnWorker(key, sessionData) {
  if (workerMap.has(key)) {
    workerMap.get(key).destroy();
  }

  let credentials;
  try {
    credentials = authSvc.decryptSession(sessionData.encrypted);
    credentials = await authSvc.ensureFreshToken(credentials);
    // Persist refreshed tokens
    const sessions = db.get('sessions') || {};
    sessions[key].encrypted = authSvc.encryptSession(credentials);
    db.set('sessions', sessions);
  } catch (err) {
    console.error(`[Worker:${key}] Token refresh failed:`, err.message);
    return;
  }

  const worker = new BotWorker({
    key,
    mcProfile:    sessionData.mcProfile,
    credentials,
    autoReconnect: sessionData.autoReconnect ?? true,
    onReconnect: async () => {
      // Re-fetch fresh session from DB before reconnect
      const sessions = db.get('sessions') || {};
      const s        = sessions[key];
      if (!s) return;
      let creds = authSvc.decryptSession(s.encrypted);
      creds     = await authSvc.ensureFreshToken(creds);
      sessions[key].encrypted = authSvc.encryptSession(creds);
      db.set('sessions', sessions);
      return creds;
    },
  });

  workerMap.set(key, worker);
  worker.connect(credentials);

  // Isolate crashes — other users unaffected
  worker.on('fatal', (err) => {
    console.error(`[Worker:${key}] Fatal crash (isolated):`, err.message);
    workerMap.delete(key);
  });
}

// ─── Restore Sessions on Startup ─────────────────────────────────────────────

async function restoreSessions() {
  const sessions = db.get('sessions') || {};
  console.log(`[Controller] Restoring ${Object.keys(sessions).length} session(s)…`);
  for (const [key, sessionData] of Object.entries(sessions)) {
    try {
      await spawnWorker(key, sessionData);
    } catch (err) {
      console.error(`[Controller] Failed to restore session ${key}:`, err.message);
    }
  }
}

// ─── Message Router ───────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.content.startsWith('!')) return;

  const args    = msg.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  try {
    switch (command) {
      case '!adduser':       return await cmdAddUser(msg);
      case '!addbot':        return await cmdAddBot(msg);
      case '!list':          return await cmdList(msg);
      case '!status':        return await cmdStatus(msg);
      case '!autoreconnect': return await cmdAutoReconnect(msg, args);
    }
  } catch (err) {
    console.error(`[Command:${command}] Unhandled error:`, err);
    reply(msg, `❌ An unexpected error occurred. Check the console.`).catch(() => {});
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`[Discord] Logged in as ${client.user.tag}`);
  await restoreSessions();
});

client.login(process.env.DISCORD_TOKEN);
