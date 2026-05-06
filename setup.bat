@echo off
setlocal EnableDelayedExpansion
title Minecraft Manager - Setup
color 0A

echo.
echo  ============================================
echo   Minecraft Manager - Full Setup (Windows)
echo  ============================================
echo.

:: ── Check Node.js ────────────────────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo  Download it from: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%V in ('node -v') do set RAW_VER=%%V
for /f "tokens=1 delims=." %%M in ('node -e "process.stdout.write(process.versions.node)"') do set NODE_MAJOR=%%M
if !NODE_MAJOR! LSS 22 (
    echo  [ERROR] Node.js v22+ is required. You have: !RAW_VER!
    echo  Download LTS from: https://nodejs.org/
    pause
    exit /b 1
)
echo  [OK] Node.js !RAW_VER! detected.

:: ── Check npm ─────────────────────────────────────────────────────────────────
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] npm not found. Reinstall Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo  [OK] npm detected.

:: ── Create project folders ───────────────────────────────────────────────────
echo.
echo  [1/5] Creating project structure...
if not exist "minecraft-manager\src\core"     mkdir "minecraft-manager\src\core"
if not exist "minecraft-manager\src\services" mkdir "minecraft-manager\src\services"
if not exist "minecraft-manager\src\utils"    mkdir "minecraft-manager\src\utils"
if not exist "minecraft-manager\auth_cache"   mkdir "minecraft-manager\auth_cache"
echo  [OK] Folders created.

:: ── Install dependencies ──────────────────────────────────────────────────────
echo.
echo  [2/5] Installing npm dependencies (this may take a minute)...
cd minecraft-manager
call npm install --save discord.js dotenv mineflayer prismarine-auth >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] npm install failed. Check your internet connection.
    cd ..
    pause
    exit /b 1
)
echo  [OK] Dependencies installed.
cd ..

:: ── Generate encryption key ───────────────────────────────────────────────────
echo.
echo  [3/5] Generating secure ENCRYPTION_KEY...
for /f %%K in ('node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"') do set ENC_KEY=%%K
echo  [OK] Key generated.

:: ── Create .env if missing ────────────────────────────────────────────────────
echo.
echo  [4/5] Setting up .env file...
if exist "minecraft-manager\.env" (
    echo  [SKIP] .env already exists - not overwriting.
) else (
    (
        echo DISCORD_TOKEN=PASTE_YOUR_DISCORD_BOT_TOKEN_HERE
        echo OWNER_ID=PASTE_YOUR_DISCORD_USER_ID_HERE
        echo ENCRYPTION_KEY=!ENC_KEY!
        echo MC_HOST=play.yourserver.net
        echo MC_PORT=25565
    ) > "minecraft-manager\.env"
    echo  [OK] .env created with a fresh ENCRYPTION_KEY.
)

:: ── Verify critical files exist ───────────────────────────────────────────────
echo.
echo  [5/5] Verifying project files...
set MISSING=0
for %%F in (
    "minecraft-manager\src\index.js"
    "minecraft-manager\src\services\AuthService.js"
    "minecraft-manager\src\core\BotWorker.js"
    "minecraft-manager\src\utils\Database.js"
    "minecraft-manager\package.json"
    "minecraft-manager\.gitignore"
) do (
    if not exist %%F (
        echo  [WARN] Missing: %%F
        set MISSING=1
    )
)
if !MISSING! == 0 (
    echo  [OK] All project files present.
)

:: ── Done ──────────────────────────────────────────────────────────────────────
echo.
echo  ============================================
echo   Setup Complete!
echo  ============================================
echo.
echo  Next steps:
echo    1. Open minecraft-manager\.env
echo    2. Replace DISCORD_TOKEN with your bot token
echo    3. Replace OWNER_ID with your Discord user ID
echo    4. Set MC_HOST to your Minecraft server address
echo    5. Run the bot:
echo.
echo         cd minecraft-manager
echo         npm start
echo.
echo  SECURITY REMINDER:
echo    - Never commit .env or database.json to Git
echo    - Your .gitignore already excludes them
echo.
pause
