#!/usr/bin/env bash
# ============================================================
# London Setup — claude + london agent + chat board reinstall
# Kabhi bhi setup dobara banana ho to bas yeh chala do:
#   bash ollama.sh
# NOTE: API key script me NAHI hai (public repo) — first run pe
#       key prompt se poochi jayegi (ollama.com → Settings → API keys).
#       Env se bhi kar sakte ho:  OLLAMA_API_KEY=xxxx ./ollama.sh
# Covers:
#   1. Ollama install
#   2. Local models : qwen2.5-coder:0.5b (fast; override: OLLAMA_MODEL=3b)
#   3. Claude Code CLI (native installer)
#   4. Cloud config in ~/.bash_aliases (+ key file ~/.ollama-cloud-key)
#   5. Chat board + london agent: is script ke bagal me (ya D:\ backup)
#      server.py / index.html / cli.py mile to wapas copy ho jayenge
# ============================================================
set -euo pipefail

CLOUD_BASE_URL="https://ollama.com"
CLOUD_MODEL="glm-5.3-flash"
MODEL="${OLLAMA_MODEL:-qwen2.5-coder:0.5b}"
ALIASES="$HOME/.bash_aliases"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- Key: env ya prompt (kabhi bhi script me hardcode mat karo) ----
if [ -z "${OLLAMA_API_KEY:-}" ]; then
    read -rp "Ollama API key do (ollama.com → Settings → API keys): " OLLAMA_API_KEY
    [ -n "$OLLAMA_API_KEY" ] || { echo "Key ke bina cloud setup nahi banega. Abort."; exit 1; }
fi

echo "============================================"
echo " London setup shuru"
echo "============================================"

echo "== 1/6 Ollama install check =="
if command -v ollama >/dev/null 2>&1; then
    echo "Ollama pehle se installed hai: $(ollama --version 2>&1)"
else
    curl -fsSL https://ollama.com/install.sh | sh
    echo "Ollama install ho gaya."
fi

echo "== 2/6 Local model pull: $MODEL (fast) =="
if ollama list 2>/dev/null | grep -q "qwen2.5-coder:0.5b"; then
    echo "0.5b pehle se pada hai, pull skip."
else
    ollama pull qwen2.5-coder:0.5b
fi
if [ "$MODEL" != "qwen2.5-coder:0.5b" ]; then
    ollama pull "$MODEL" || echo "(bada model skip)"
fi
ollama list

echo "== 3/6 Claude Code CLI install =="
if [ -x "$HOME/.local/bin/claude" ] || command -v claude >/dev/null 2>&1; then
    echo "Claude Code pehle se hai: $(claude --version 2>/dev/null | head -1)"
else
    curl -fsSL https://claude.ai/install.sh | bash
    echo "Claude Code install ho gaya (native install, ~/.local/bin me)."
fi
export PATH="$HOME/.local/bin:$PATH"

echo "== 4/6 Cloud config (.bash_aliases) =="
# Purani file ka backup, phir block replace (idempotent — dobara chalao to bhi safe)
if [ -f "$ALIASES" ]; then
    cp "$ALIASES" "$ALIASES.bak.$(date +%Y%m%d-%H%M%S)"
    sed -i '/# BEGIN-CLAUDE-OLLAMA/,/# END-CLAUDE-OLLAMA/d' "$ALIASES"
fi

cat >> "$ALIASES" <<EOF
# BEGIN-CLAUDE-OLLAMA
# ---- Claude Code + london setup via Ollama cloud (permanent) ----
export OLLAMA_API_KEY="$OLLAMA_API_KEY"
export ANTHROPIC_BASE_URL="$CLOUD_BASE_URL"
export ANTHROPIC_AUTH_TOKEN="\$OLLAMA_API_KEY"
export ANTHROPIC_API_KEY="\$OLLAMA_API_KEY"
export ANTHROPIC_MODEL="$CLOUD_MODEL"
export PATH="\$HOME/.local/bin:\$PATH"

# Shortcut: bas "claude" chalao, model aur key apne aap lagengi
alias claude-ollama='claude --model $CLOUD_MODEL'
# END-CLAUDE-OLLAMA

alias chat-ui="cd ~/local-chat && (curl -s -o /dev/null http://localhost:8088 || nohup python3 server.py >/dev/null 2>&1 &) ; echo Browser kholo: http://localhost:8088"
alias london="python3 ~/london/cli.py"   # apna terminal agent
EOF

# key-file (env na ho to server.py/london isi se cloud paate hain)
printf %s "$OLLAMA_API_KEY" > "$HOME/.ollama-cloud-key"
chmod 600 "$HOME/.ollama-cloud-key"

if ! grep -q "bash_aliases" "$HOME/.bashrc" 2>/dev/null; then
    [ -f "$ALIASES" ] || touch "$ALIASES"
    echo '[ -f ~/.bash_aliases ] && . ~/.bash_aliases' >> "$HOME/.bashrc"
fi

# ---- 5+6: chat board aur london agent ki files uthao (script ke bagal ya D: backup) ----
pick_src() {  # $1 = filename → pehle script ke folder me, fir D:\sanjay per
    for d in "$SCRIPT_DIR" "/mnt/d/sanjay per"; do
        [ -f "$d/$1" ] && { echo "$d/$1"; return 0; }
    done
    return 1
}

echo "== 5/6 Chat board (local-chat) =="
src_html="$(pick_src chat.html || true)"
src_html="${src_html:-$(pick_src index.html || true)}"
src_srv="$(pick_src server.py || true)"
if [ -n "$src_html" ] && [ -n "$src_srv" ]; then
    mkdir -p "$HOME/local-chat"
    cp "$src_html" "$HOME/local-chat/index.html"
    cp "$src_srv"  "$HOME/local-chat/server.py"
    echo "local-chat wapas copy kiya ($SCRIPT_DIR / D: backup se)."
else
    echo "⚠️ chat board ki files paas me nahi mili — board skip (baki sab theek)."
fi

echo "== 6/6 london agent =="
src_cli="$(pick_src cli.py || true)"
if [ -f "$HOME/london/cli.py" ]; then
    echo "london pehle se hai."
elif [ -n "$src_cli" ]; then
    mkdir -p "$HOME/london"
    cp "$src_cli" "$HOME/london/cli.py"
    echo "london wapas copy kiya ($src_cli se)."
else
    echo "⚠️ cli.py paas me nahi mila — london agent skip."
fi

echo ""
echo "============================================"
echo " Setup complete! ✅"
echo " Claude (cloud speed, limited quota):  claude"
echo " london  (terminal agent):             london"
echo " Chat board (browser, agar files mile): chat-ui → localhost:8088"
echo " Local models (offline, slow):          ollama run qwen2.5-coder:0.5b"
echo "============================================"