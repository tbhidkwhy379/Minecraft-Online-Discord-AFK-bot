'use strict';

const crypto  = require('crypto');
const { Authflow, Titles } = require('prismarine-auth');

const ALGORITHM     = 'aes-256-gcm';
const IV_LENGTH     = 12;   // 96-bit IV — recommended for GCM
const TAG_LENGTH    = 16;   // 128-bit auth tag
const SALT          = Buffer.from('minecraft-manager-salt-v1');  // non-secret domain separator

// Derive a fixed 32-byte key from the raw env var using HKDF-SHA256.
// This means even a 64+ char passphrase is safely normalised.
function deriveKey() {
  return crypto.hkdfSync(
    'sha256',
    Buffer.from(process.env.ENCRYPTION_KEY, 'utf8'),
    SALT,
    Buffer.alloc(0),
    32
  );
}

class AuthService {
  constructor() {
    this._key = deriveKey();
  }

  // ─── Encryption ────────────────────────────────────────────────────────────

  /**
   * Encrypts a plain JS object to a base64 string.
   * Format: <iv(12B)><ciphertext><tag(16B)> — all base64-encoded together.
   *
   * @param {object} obj
   * @returns {string} base64 blob
   */
  encryptSession(obj) {
    const iv      = crypto.randomBytes(IV_LENGTH);
    const cipher  = crypto.createCipheriv(ALGORITHM, this._key, iv, { authTagLength: TAG_LENGTH });
    const plain   = Buffer.from(JSON.stringify(obj), 'utf8');
    const enc     = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag     = cipher.getAuthTag();
    return Buffer.concat([iv, enc, tag]).toString('base64');
  }

  /**
   * Decrypts a base64 blob back to a JS object.
   * Throws if the authentication tag is invalid (tampered data).
   *
   * @param {string} blob base64
   * @returns {object}
   */
  decryptSession(blob) {
    const buf        = Buffer.from(blob, 'base64');
    const iv         = buf.subarray(0, IV_LENGTH);
    const tag        = buf.subarray(buf.length - TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this._key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  }

  // ─── Microsoft OAuth2 Device Code Flow ────────────────────────────────────

  /**
   * Begins a Device Code authentication flow.
   * Calls `onCode(userCode, verificationUri)` once the code is available,
   * then waits for the user to complete login in their browser.
   *
   * @param {Function} onCode async (userCode, verificationUri) => void
   * @returns {Promise<{accessToken, refreshToken, expiresAt, mcProfile}>}
   */
  async startDeviceCodeFlow(onCode) {
    return new Promise((resolve, reject) => {
      const flow = new Authflow(undefined, './auth_cache', {
        authTitle: Titles.MinecraftJava,
        deviceType: 'Win32',
        flow: 'sisu',
      });

      flow.getMinecraftJavaToken({
        onMsaCode: async ({ user_code, verification_uri }) => {
          await onCode(user_code, verification_uri);
        },
      })
      .then(async (tokenData) => {
        // tokenData: { token (access), refresh_token, expires_in, profile }
        const expiresAt = Date.now() + (tokenData.expires_in ?? 3600) * 1000;
        resolve({
          accessToken:  tokenData.token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          mcProfile: {
            id:   tokenData.profile.id,
            name: tokenData.profile.name,
          },
        });
      })
      .catch(reject);
    });
  }

  // ─── Smart Token Refresh ───────────────────────────────────────────────────

  /**
   * Inspects `credentials.expiresAt`. If the token expires within 30 minutes,
   * performs a silent refresh and returns updated credentials.
   * Otherwise returns credentials unchanged.
   *
   * @param {{ accessToken, refreshToken, expiresAt }} credentials
   * @returns {Promise<{ accessToken, refreshToken, expiresAt }>}
   */
  async ensureFreshToken(credentials) {
    const THIRTY_MINUTES = 30 * 60 * 1000;
    const timeLeft       = credentials.expiresAt - Date.now();

    if (timeLeft > THIRTY_MINUTES) {
      return credentials;  // Still plenty of life — no-op
    }

    console.log(`[AuthService] Token expiring in ${Math.round(timeLeft / 60000)}m — refreshing…`);

    const refreshed = await this._refreshAccessToken(credentials.refreshToken);
    console.log('[AuthService] Token refreshed successfully.');
    return refreshed;
  }

  /**
   * Uses the stored refresh_token to obtain a new access_token.
   *
   * prismarine-auth handles the MSAL token exchange internally;
   * we re-run the Authflow with the cached refresh token on disk.
   * If the cache is stale or missing, this will throw.
   *
   * @param {string} _refreshToken (kept for future direct MSAL calls)
   * @returns {Promise<{ accessToken, refreshToken, expiresAt }>}
   */
  async _refreshAccessToken(_refreshToken) {
    // prismarine-auth caches the refresh token to ./auth_cache automatically.
    // Instantiating a new Authflow will use that cache for a silent refresh.
    return new Promise((resolve, reject) => {
      const flow = new Authflow(undefined, './auth_cache', {
        authTitle: Titles.MinecraftJava,
        deviceType: 'Win32',
        flow: 'sisu',
      });

      flow.getMinecraftJavaToken()
        .then((tokenData) => {
          resolve({
            accessToken:  tokenData.token,
            refreshToken: tokenData.refresh_token ?? _refreshToken,
            expiresAt:    Date.now() + (tokenData.expires_in ?? 3600) * 1000,
          });
        })
        .catch(reject);
    });
  }
}

module.exports = AuthService;
