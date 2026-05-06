#!/usr/bin/env bash
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${RESET}    $*"; }
info() { echo -e "  ${CYAN}[INFO]${RESET}  $*"; }
warn() { echo -e "  ${YELLOW}[WARN]${RESET}  $*"; }
fail() { echo -e "  ${RED}[ERROR]${RESET} $*" >&2; exit 1; }

echo
echo -e "${BOLD} ============================================${RESET}"
echo -e "${BOLD}  Minecraft Manager - Full Setup (Linux/Mac)${RESET}"
echo -e "${BOLD} ============================================${RESET}"
echo

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    fail "Node.js not found. Install from https://nodejs.org/ or via your package manager:\n\n  macOS:  brew install node\n  Ubuntu: sudo apt install nodejs npm"
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
NODE_VER=$(node -v)

if (( NODE_MAJOR < 22 )); then
    fail "Node.js v22+ required. You have ${NODE_VER}.\n  Update via: https://nodejs.org/ or use nvm: nvm install --lts"
fi
ok "Node.js ${NODE_VER} detected."

# ── Check npm ─────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    fail "npm not found. Reinstall Node.js from https://nodejs.org/"
fi
ok "npm $(npm -v) detected."

# ── Create project structure ───────────────────────────────────────────────────
echo
echo -e "${BOLD}  [1/5]${RESET} Creating project structure..."
mkdir -p minecraft-manager/src/{core,services,utils}
mkdir -p minecraft-manager/auth_cache
ok "Folders created."

# ── Install dependencies ──────────────────────────────────────────────────────
echo
echo -e "${BOLD}  [2/5]${RESET} Installing npm dependencies (this may take a minute)..."
cd minecraft-manager
if ! npm install --save discord.js dotenv mineflayer prismarine-auth 2>&1 | tail -3; then
    fail "npm install failed. Check your internet connection and try again."
fi
ok "Dependencies installed."
cd ..

# ── Generate encryption key ───────────────────────────────────────────────────
echo
echo -e "${BOLD}  [3/5]${RESET} Generating secure ENCRYPTION_KEY..."
ENC_KEY=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))")
ok "Key generated (96 hex chars)."

# ── Create .env ───────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}  [4/5]${RESET} Setting up .env file..."
ENV_FILE="minecraft-manager/.env"

if [[ -f "$ENV_FILE" ]]; then
    warn ".env already exists — not overwriting. Your keys are safe."
else
    cat > "$ENV_FILE" <<EOF
# Minecraft Manager — Environment Configuration
# Fill in the values below, then run: npm start

# Discord bot token (https://discord.com/developers/applications)
DISCORD_TOKEN=PASTE_YOUR_DISCORD_BOT_TOKEN_HERE

# Your Discord user ID (enable Developer Mode → right-click yourself → Copy User ID)
OWNER_ID=PASTE_YOUR_DISCORD_USER_ID_HERE

# AES-256-GCM encryption key (auto-generated — do not change unless you wipe database.json)
ENCRYPTION_KEY=${ENC_KEY}

# Minecraft server
MC_HOST=play.yourserver.net
MC_PORT=25565
EOF
    # Lock down permissions — only the current user can read the .env
    chmod 600 "$ENV_FILE"
    ok ".env created with restricted permissions (chmod 600)."
fi

# ── Verify files ───────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}  [5/5]${RESET} Verifying project files..."
MISSING=0
for f in \
    "minecraft-manager/src/index.js" \
    "minecraft-manager/src/services/AuthService.js" \
    "minecraft-manager/src/core/BotWorker.js" \
    "minecraft-manager/src/utils/Database.js" \
    "minecraft-manager/package.json" \
    "minecraft-manager/.gitignore"
do
    if [[ ! -f "$f" ]]; then
        warn "Missing: $f"
        MISSING=1
    fi
done
[[ $MISSING -eq 0 ]] && ok "All project files present."

# ── Done ──────────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD} ============================================${RESET}"
echo -e "${BOLD}  Setup Complete!${RESET}"
echo -e "${BOLD} ============================================${RESET}"
echo
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "    1. Edit ${CYAN}minecraft-manager/.env${RESET}"
echo -e "       • Set ${YELLOW}DISCORD_TOKEN${RESET} to your bot token"
echo -e "       • Set ${YELLOW}OWNER_ID${RESET} to your Discord user ID"
echo -e "       • Set ${YELLOW}MC_HOST${RESET} to your Minecraft server address"
echo
echo -e "    2. Run the bot:"
echo -e "       ${BOLD}cd minecraft-manager && npm start${RESET}"
echo
echo -e "  ${RED}SECURITY REMINDER:${RESET}"
echo -e "    • Never commit ${YELLOW}.env${RESET} or ${YELLOW}database.json${RESET} to Git"
echo -e "    • Your .gitignore already excludes both"
echo -e "    • .env has been set to ${YELLOW}chmod 600${RESET} (owner read/write only)"
echo
