'use strict';

const EventEmitter = require('events');
const mineflayer   = require('mineflayer');

// Minecraft Java 26.1 "Tiny Takeover" — version string used by mineflayer.
// The new versioning scheme (year.minor) maps to the internal protocol below.
const MC_VERSION   = '26.1';

// Grace period before reconnect after a non-manual kick (ms)
const RECONNECT_DELAY_MS = 60_000;

// AFK movement interval: send a small look packet every N ms to avoid
// anti-AFK kicks on servers that check for idle clients.
const AFK_INTERVAL_MS = 45_000;

class BotWorker extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   opts.key            Unique worker key (discordId::mcUuid)
   * @param {object}   opts.mcProfile      { id, name }
   * @param {object}   opts.credentials    { accessToken, expiresAt }
   * @param {boolean}  opts.autoReconnect
   * @param {Function} opts.onReconnect    async () => credentials — fetches fresh creds before reconnect
   */
  constructor({ key, mcProfile, credentials, autoReconnect, onReconnect }) {
    super();
    this.key           = key;
    this.mcProfile     = mcProfile;
    this.autoReconnect = autoReconnect ?? true;
    this._onReconnect  = onReconnect;
    this._manualLogout = false;
    this._reconnTimer  = null;
    this._afkTimer     = null;
    this.isConnected   = false;
    this._bot          = null;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Connects the Mineflayer bot to the target server.
   * Server host/port are read from env: MC_HOST, MC_PORT.
   *
   * @param {{ accessToken: string }} credentials
   */
  connect(credentials) {
    this._manualLogout = false;

    try {
      this._bot = mineflayer.createBot({
        host:    process.env.MC_HOST || 'localhost',
        port:    parseInt(process.env.MC_PORT || '25565', 10),
        username: this.mcProfile.name,
        auth:    'microsoft',
        // Supply the pre-authenticated token directly so mineflayer
        // does not open a second browser/device-code prompt.
        accessToken: credentials.accessToken,
        version: MC_VERSION,
        // Minecraft 26.1 uses the updated data component system for items/blocks.
        // mineflayer 5.x+ exposes this flag to enable v1.21+ component parsing.
        useDataComponents: true,
        // Keep the TCP connection alive at the OS level
        keepAlive: true,
        checkTimeoutInterval: 30_000,
      });
    } catch (err) {
      console.error(`[BotWorker:${this.key}] Failed to create bot:`, err.message);
      this.emit('fatal', err);
      return;
    }

    this._attachListeners();
    console.log(`[BotWorker:${this.key}] Connecting as ${this.mcProfile.name} (MC ${MC_VERSION})…`);
  }

  /**
   * Returns a snapshot of the bot's current health/hunger/position.
   * Safe to call at any time; returns nulls if not connected.
   *
   * @returns {{ health, food, dimension, x, y, z }}
   */
  getStatus() {
    if (!this._bot || !this.isConnected) {
      return { health: null, food: null, dimension: null, x: null, y: null, z: null };
    }
    const pos = this._bot.entity?.position;
    return {
      health:    this._bot.health?.toFixed(1) ?? '?',
      food:      this._bot.food ?? '?',
      dimension: this._bot.game?.dimension ?? 'unknown',
      x:         pos ? Math.floor(pos.x) : '?',
      y:         pos ? Math.floor(pos.y) : '?',
      z:         pos ? Math.floor(pos.z) : '?',
    };
  }

  /**
   * Permanently destroys this worker. Does NOT schedule a reconnect.
   */
  destroy() {
    this._manualLogout = true;
    this._clearTimers();
    if (this._bot) {
      try { this._bot.quit(); } catch (_) {}
      this._bot = null;
    }
    this.isConnected = false;
    console.log(`[BotWorker:${this.key}] Destroyed.`);
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  _attachListeners() {
    const bot = this._bot;

    bot.once('spawn', () => {
      this.isConnected = true;
      console.log(`[BotWorker:${this.key}] ✅ Spawned in ${bot.game?.dimension ?? 'unknown'}.`);
      this._startAfkLoop();
    });

    bot.on('health', () => {
      // Health packets arrive frequently; no-op here but could be used for alerts.
    });

    bot.on('kicked', (reason) => {
      this.isConnected = false;
      this._clearTimers();
      const readable = typeof reason === 'string' ? reason : JSON.stringify(reason);
      console.warn(`[BotWorker:${this.key}] Kicked: ${readable}`);
      this._scheduleReconnect();
    });

    bot.on('end', (reason) => {
      this.isConnected = false;
      this._clearTimers();
      console.warn(`[BotWorker:${this.key}] Connection ended (${reason}).`);
      this._scheduleReconnect();
    });

    bot.on('error', (err) => {
      // Non-fatal networking errors — log but let 'end' handle reconnect.
      console.error(`[BotWorker:${this.key}] Error: ${err.message}`);
    });
  }

  _startAfkLoop() {
    this._afkTimer = setInterval(() => {
      if (!this._bot || !this.isConnected) return;
      // Rotate view slightly to signal activity to anti-AFK plugins.
      const yaw   = (this._bot.entity.yaw + 0.01) % (2 * Math.PI);
      const pitch = this._bot.entity.pitch;
      this._bot.look(yaw, pitch, false);
    }, AFK_INTERVAL_MS);
  }

  _scheduleReconnect() {
    if (this._manualLogout)        return;  // User explicitly logged out
    if (!this.autoReconnect)       return;  // Feature disabled
    if (this._reconnTimer)         return;  // Already waiting

    console.log(`[BotWorker:${this.key}] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s…`);

    this._reconnTimer = setTimeout(async () => {
      this._reconnTimer = null;
      let credentials;
      try {
        credentials = await this._onReconnect();
      } catch (err) {
        console.error(`[BotWorker:${this.key}] Could not fetch fresh credentials for reconnect:`, err.message);
        this.emit('fatal', err);
        return;
      }
      this.connect(credentials);
    }, RECONNECT_DELAY_MS);
  }

  _clearTimers() {
    if (this._afkTimer)  { clearInterval(this._afkTimer);  this._afkTimer  = null; }
    if (this._reconnTimer){ clearTimeout(this._reconnTimer); this._reconnTimer = null; }
  }
}

module.exports = BotWorker;
