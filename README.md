# 🎮 Minecraft Manager

A high-performance, **multi-user Discord bot** that manages Minecraft Java 26.1 ("Tiny Takeover") bot accounts. Each Discord user can authenticate their own Microsoft account, and their bot runs in full isolation — crashes are contained, tokens are encrypted at rest, and sessions survive bot restarts.

---

## ✨ Features

| Feature | Detail |
|---|---|
| **Multi-user isolation** | Each `BotWorker` runs independently; a crash in User A's bot never affects User B |
| **Microsoft OAuth2** | Device-code flow via `prismarine-auth` — no password ever stored |
| **AES-256-GCM encryption** | All session data (tokens, UUIDs) encrypted before disk write |
| **Smart token refresh** | Silently refreshes tokens expiring within 30 minutes |
| **Auto-reconnect** | Detects kicks/disconnects and reconnects after 60 s |
| **Atomic saves** | Database writes are crash-safe via tmp → rename pattern |
| **Role hierarchy** | Owner → Whitelisted users → Everyone else |
| **MC 26.1 support** | Uses `useDataComponents: true` for the updated item/block data component system |

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js ≥ 22 LTS**
- A **Discord bot token** — create one at [discord.com/developers](https://discord.com/developers/applications)
- A **Minecraft Java** account (Microsoft login)

### 2. Clone & Install

```bash
git clone tbhidkwhy379/Minecraft-Online-Discord-AFK-bot
cd Minecraft-Online-Discord-AFK-bot
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
DISCORD_TOKEN=your-discord-bot-token
OWNER_ID=your-discord-user-id
ENCRYPTION_KEY=<96-hex-char random string>
MC_HOST=play.yourserver.net
MC_PORT=25565
```

> **Generate a strong key:**
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

### 4. Run

```bash
npm start
```

---

## 💬 Discord Commands

| Command | Who can use | Description |
|---|---|---|
| `!adduser @User` | Owner only | Whitelists a Discord user to add bots |
| `!addbot` | Whitelisted users | Starts Microsoft Device Code login (sent via DM) |
| `!list` | Whitelisted users | Lists your bots (Owner sees all) |
| `!status` | Whitelisted users | Shows health, hunger, and world position |
| `!autoreconnect on\|off` | Whitelisted users | Toggles auto-reconnect for your bots |

### Typical first-run flow

```
# In Discord:
[Owner]  !adduser @Alice
[Alice]  !addbot
# → Alice receives a DM with a Microsoft Device Code
# → Alice completes login in her browser
# → Bot spawns and confirms with the Minecraft username
[Alice]  !status
# ❤️ Health: 20.0/20  🍗 Food: 20/20
# 📍 World: minecraft:overworld @ (128, 64, -200)
```

---

## 🔐 Security Architecture

### AES-256-GCM Encryption

All sensitive session data (Microsoft access tokens, refresh tokens, Minecraft UUIDs) is **encrypted before being written to `database.json`** using AES-256-GCM.

```
Plain session object
       │
       ▼
JSON.stringify()
       │
       ▼
crypto.randomBytes(12)  ─→  96-bit IV (unique per write)
       │
       ▼
createCipheriv('aes-256-gcm', derivedKey, iv)
       │
       ├─→  Ciphertext
       └─→  128-bit Authentication Tag  (GCM MAC)
                          │
                          ▼
            Buffer: [ IV (12B) | Ciphertext | Tag (16B) ]
                          │
                          ▼
                     Base64 string  →  database.json
```

**Why GCM?**

- GCM combines confidentiality (CTR mode) with integrity verification (GHASH MAC). If any byte of the stored blob is tampered with, `decipher.final()` throws — the data is silently rejected rather than decrypted to garbage.
- The 96-bit IV is cryptographically random per write, preventing IV reuse attacks.
- The 128-bit auth tag binds the ciphertext to the IV, preventing cut-and-paste attacks.

### Key Derivation

The raw `ENCRYPTION_KEY` string is passed through **HKDF-SHA256** (Node.js built-in) before use:

```
HKDF(inputKeyMaterial=ENCRYPTION_KEY, salt="minecraft-manager-salt-v1", info="", length=32)
  → 32-byte derived key
```

This means any passphrase ≥ 32 characters is safely normalised to exactly 256 bits regardless of its original length or entropy distribution.

### Atomic Database Writes

To prevent corruption on sudden power loss or SIGKILL:

```
new state
    │
    ▼
database.json.tmp   ← write + fsync (flush OS buffers to disk)
    │
    ▼
rename .tmp → database.json   ← atomic at POSIX kernel level
```

If the process dies between steps 1 and 2, the original `database.json` is untouched.

### What is Never Stored

- Microsoft passwords (Device Code flow — never touches a password)
- The `ENCRYPTION_KEY` itself (stays in memory from `process.env`)
- Plaintext tokens (all encrypted before any `db.set()` call)

---

## 📁 Project Structure

```
minecraft-manager/
├── src/
│   ├── index.js                  # Discord client + command router (Controller)
│   ├── core/
│   │   └── BotWorker.js          # Mineflayer bot (isolated per user)
│   ├── services/
│   │   └── AuthService.js        # Microsoft OAuth2 + AES-256-GCM
│   └── utils/
│       └── Database.js           # Atomic JSON persistence
├── .env.example                  # Environment template (safe to commit)
├── .gitignore                    # Excludes .env, database.json, node_modules
├── package.json
└── README.md
```

---

## 🛡️ GitHub Security Checklist

Before pushing to a public repository:

- [ ] `database.json` is in `.gitignore`
- [ ] `.env` is in `.gitignore`
- [ ] `auth_cache/` is in `.gitignore`
- [ ] `.env.example` contains **no real secrets**
- [ ] `ENCRYPTION_KEY` in `.env` is ≥ 32 characters (the bot will throw on startup if not)
- [ ] You have run `git status` and confirmed no secret files are staged

---

## 🔧 Minecraft 26.1 ("Tiny Takeover") Notes

The 2025 versioning change means Minecraft Java editions are now named `YY.minor` (e.g. `26.1`). Internally, item and block NBT was replaced with a **Data Component** system starting in 1.21. This project enables `useDataComponents: true` in the mineflayer options to ensure correct parsing of item stacks, inventory slots, and block entity data under the new format.

---

## 📄 License

MIT
