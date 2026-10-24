#!/usr/bin/env bash
# ============================================================
# Ollama + Claude Code — full reinstall script
# Kabhi bhi setup dobara banana ho to bas yeh chala do:
#   bash ollama.sh
# NOTE: API key script me NAHI hai (public repo) — first run pe
#       key prompt se poochi jayegi (ollama.com → Settings → API keys).
#       Env se bhi kar sakte ho:  OLLAMA_API_KEY=xxxx ./ollama.sh
# Covers:
#   1. Ollama install
#   2. Local model : qwen2.5-coder:3b (override: OLLAMA_MODEL=7b ./ollama.sh)
#   3. Claude Code CLI (native installer)
#   4. Claude via Ollama cloud (glm-5.3-flash) in ~/.bash_aliases
# ============================================================
set -euo pipefail

CLOUD_BASE_URL="https://ollama.com"
CLOUD_MODEL="glm-5.3-flash"
MODEL="${OLLAMA_MODEL:-qwen2.5-coder:3b}"
ALIASES="$HOME/.bash_aliases"

# ---- Key: env ya prompt (kabhi bhi script me hardcode mat karo) ----
if [ -z "${OLLAMA_API_KEY:-}" ]; then
    read -rp "Ollama API key do (ollama.com → Settings → API keys): " OLLAMA_API_KEY
    [ -n "$OLLAMA_API_KEY" ] || { echo "Key ke bina claude-cloud setup nahi banega. Abort."; exit 1; }
fi

echo "============================================"
echo " Ollama + Claude setup shuru"
echo "============================================"

echo "== 1/4 Ollama install check =="
if command -v ollama >/dev/null 2>&1; then
    echo "Ollama pehle se installed hai: $(ollama --version 2>&1)"
else
    curl -fsSL https://ollama.com/install.sh | sh
    echo "Ollama install ho gaya."
fi

echo "== 2/4 Local model pull: $MODEL =="
if ollama list 2>/dev/null | grep -q "qwen2.5-coder"; then
    echo "Model pehle se pada hai, pull skip."
else
    ollama pull "$MODEL"
fi
ollama list

echo "== 3/4 Claude Code CLI install =="
if [ -x "$HOME/.local/bin/claude" ] || command -v claude >/dev/null 2>&1; then
    echo "Claude Code pehle se hai: $(claude --version 2>/dev/null | head -1)"
else
    curl -fsSL https://claude.ai/install.sh | bash
    echo "Claude Code install ho gaya (native install, ~/.local/bin me)."
fi
export PATH="$HOME/.local/bin:$PATH"

echo "== 4/4 Claude-via-Ollama config (.bash_aliases) =="
# Purani file ka backup, phir block replace (idempotent — dobara chalao to bhi safe)
if [ -f "$ALIASES" ]; then
    cp "$ALIASES" "$ALIASES.bak.$(date +%Y%m%d-%H%M%S)"
    sed -i '/# BEGIN-CLAUDE-OLLAMA/,/# END-CLAUDE-OLLAMA/d' "$ALIASES"
fi

cat >> "$ALIASES" <<EOF
# BEGIN-CLAUDE-OLLAMA
# ---- Claude Code setup via Ollama cloud (permanent) ----
export OLLAMA_API_KEY="$OLLAMA_API_KEY"
export ANTHROPIC_BASE_URL="$CLOUD_BASE_URL"
export ANTHROPIC_AUTH_TOKEN="\$OLLAMA_API_KEY"
export ANTHROPIC_API_KEY="\$OLLAMA_API_KEY"
export ANTHROPIC_MODEL="$CLOUD_MODEL"
export PATH="\$HOME/.local/bin:\$PATH"

# Shortcut: bas "claude" chalao, model aur key apne aap lagengi
alias claude-ollama='claude --model $CLOUD_MODEL'
# END-CLAUDE-OLLAMA
EOF

# bashrc se aliases load karwana
if ! grep -q "bash_aliases" "$HOME/.bashrc" 2>/dev/null; then
    [ -f "$HOME/.bash_aliases" ] || touch "$ALIASES"
    echo '[ -f ~/.bash_aliases ] && . ~/.bash_aliases' >> "$HOME/.bashrc"
fi

echo ""
echo "============================================"
echo " Setup complete! ✅"
echo " Check:  source $ALIASES && claude --version"
echo " Local : ollama run $MODEL"
echo " Cloud : claude (glm-5.3-flash via ollama.com)"
echo "============================================"