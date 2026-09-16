#!/usr/bin/env bash
set -euo pipefail

APP_NAME="amphitrite"
DEFAULT_REPO_URL="https://github.com/ottopresser/amphitrite.git"
DEFAULT_INSTALL_DIR="/opt/amphitrite"
DEFAULT_USER="www-data"
DEFAULT_GROUP="www-data"
DEFAULT_PORT="8787"

INSTALL_DIR="$DEFAULT_INSTALL_DIR"
RUN_USER="$DEFAULT_USER"
RUN_GROUP="$DEFAULT_GROUP"
PORT="$DEFAULT_PORT"
ENABLE_SYSTEMD="false"
START_SERVICE="false"
SKIP_CLONE="false"
REPO_URL="$DEFAULT_REPO_URL"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FALLBACK_WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

print_help() {
  cat <<'EOF'
Amphitrite production install script

Usage:
  ./scripts/install.sh [options]

Options:
  --repo-url URL          Git URL to clone/pull (default: GitHub repository).
  --install-dir PATH      Install path (default: /opt/amphitrite).
  --port PORT             App port (default: 8787).
  --user USER             Service user (default: www-data).
  --group GROUP           Service group (default: www-data).
  --systemd               Install a systemd unit.
  --start                 Enable and start the systemd unit (implies --systemd).
  --skip-clone            Use existing files in --install-dir, skip clone/pull.
  --help                  Show this help.

Examples:
  ./scripts/install.sh --systemd --start
  ./scripts/install.sh --repo-url https://github.com/example/amphitrite.git --systemd --start
  ./scripts/install.sh --install-dir /srv/amphitrite --port 9000 --systemd
EOF
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

run_as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  echo "This action requires root privileges. Re-run as root or install sudo." >&2
  exit 1
}

run_shell_as_root() {
  local command="$1"

  if [[ $EUID -eq 0 ]]; then
    bash -lc "$command"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo bash -lc "$command"
    return
  fi

  echo "This action requires root privileges. Re-run as root or install sudo." >&2
  exit 1
}

install_packages() {
  local packages=("$@")

  if command -v apt-get >/dev/null 2>&1; then
    run_as_root apt-get update
    run_as_root apt-get install -y "${packages[@]}"
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    run_as_root dnf install -y "${packages[@]}"
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    run_as_root yum install -y "${packages[@]}"
    return
  fi

  if command -v zypper >/dev/null 2>&1; then
    run_as_root zypper --non-interactive install "${packages[@]}"
    return
  fi

  if command -v pacman >/dev/null 2>&1; then
    run_as_root pacman -Sy --noconfirm "${packages[@]}"
    return
  fi

  echo "Unsupported package manager. Install these manually: ${packages[*]}" >&2
  exit 1
}

ensure_base_dependencies() {
  local missing=()

  command -v git >/dev/null 2>&1 || missing+=(git)
  command -v rsync >/dev/null 2>&1 || missing+=(rsync)
  command -v curl >/dev/null 2>&1 || missing+=(curl)

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Installing missing base dependencies: ${missing[*]}"
    install_packages "${missing[@]}"
  fi
}

ensure_node_and_pnpm() {
  local min_node_major=22

  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found; attempting to install nodejs and npm"
    install_packages nodejs npm
  fi

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"

  if [[ "$node_major" -lt "$min_node_major" ]]; then
    echo "Detected Node.js v$(node -v), but pnpm@11 requires Node >= ${min_node_major}."

    if command -v apt-get >/dev/null 2>&1; then
      echo "Upgrading Node.js to 22.x via NodeSource"
      install_packages ca-certificates curl gnupg
      run_shell_as_root "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
      run_as_root apt-get install -y nodejs
      hash -r
      node_major="$(node -p 'process.versions.node.split(".")[0]')"
    fi

    if [[ "$node_major" -lt "$min_node_major" ]]; then
      echo "Unable to upgrade Node.js automatically. Install Node 22+ and re-run." >&2
      exit 1
    fi
  fi

  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  echo "pnpm not found; attempting install via corepack/npm"

  if command -v corepack >/dev/null 2>&1; then
    corepack enable || true
    corepack prepare pnpm@11.5.2 --activate
  elif command -v npm >/dev/null 2>&1; then
    if [[ $EUID -eq 0 ]]; then
      npm install -g pnpm@11.5.2
    else
      run_as_root npm install -g pnpm@11.5.2
    fi
  else
    echo "npm is missing; attempting to install npm"
    install_packages npm
    if [[ $EUID -eq 0 ]]; then
      npm install -g pnpm@11.5.2
    else
      run_as_root npm install -g pnpm@11.5.2
    fi
  fi

  hash -r
  require_command pnpm
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo-url)
        REPO_URL="$2"
        shift 2
        ;;
      --install-dir)
        INSTALL_DIR="$2"
        shift 2
        ;;
      --port)
        PORT="$2"
        shift 2
        ;;
      --user)
        RUN_USER="$2"
        shift 2
        ;;
      --group)
        RUN_GROUP="$2"
        shift 2
        ;;
      --systemd)
        ENABLE_SYSTEMD="true"
        shift
        ;;
      --start)
        ENABLE_SYSTEMD="true"
        START_SERVICE="true"
        shift
        ;;
      --skip-clone)
        SKIP_CLONE="true"
        shift
        ;;
      --help)
        print_help
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        print_help
        exit 1
        ;;
    esac
  done
}

ensure_install_dir() {
  mkdir -p "$INSTALL_DIR"
}

sync_code() {
  if [[ "$SKIP_CLONE" == "true" ]]; then
    if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
      echo "--skip-clone set but package.json not found in $INSTALL_DIR" >&2
      exit 1
    fi
    return
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "Updating existing repository in $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" pull --ff-only
  else
    echo "Cloning repository into $INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
}

setup_env_file() {
  local env_file="$INSTALL_DIR/.env.local"
  local env_example="$INSTALL_DIR/.env.example"

  if [[ -f "$env_file" ]]; then
    echo ".env.local already exists; leaving it unchanged"
    return
  fi

  if [[ -f "$env_example" ]]; then
    cp "$env_example" "$env_file"
    echo "Created .env.local from .env.example"
  else
    cat > "$env_file" <<'EOF'
POSEIDON_SERVERS=[{"id":"vmhost1","name":"vmhost1.home.lan","baseUrl":"http://vmhost1.home.lan:8000","headers":{"x-api-key":"replace-with-api-key","x-admin-token":"optional-admin-token"}}]
EOF
    echo "Created .env.local template"
  fi
}

prepare_runtime_permissions() {
  if [[ "$ENABLE_SYSTEMD" != "true" ]]; then
    return
  fi

  if ! getent passwd "$RUN_USER" >/dev/null; then
    echo "Service user does not exist: $RUN_USER" >&2
    exit 1
  fi

  if ! getent group "$RUN_GROUP" >/dev/null; then
    echo "Service group does not exist: $RUN_GROUP" >&2
    exit 1
  fi

  run_as_root mkdir -p "$INSTALL_DIR/data"
  run_as_root chown -R "$RUN_USER:$RUN_GROUP" "$INSTALL_DIR/data"
  run_as_root chmod 750 "$INSTALL_DIR/data"

  if [[ -f "$INSTALL_DIR/.env.local" ]]; then
    run_as_root chown "$RUN_USER:$RUN_GROUP" "$INSTALL_DIR/.env.local"
    run_as_root chmod 600 "$INSTALL_DIR/.env.local"
  fi
}

install_dependencies_and_build() {
  pushd "$INSTALL_DIR" >/dev/null
  pnpm install --frozen-lockfile
  pnpm build
  popd >/dev/null
}

write_systemd_unit() {
  local unit_path="/etc/systemd/system/${APP_NAME}.service"

  if [[ $EUID -ne 0 ]]; then
    echo "Systemd unit install requires root. Re-run with sudo for --systemd." >&2
    exit 1
  fi

  cat > "$unit_path" <<EOF
[Unit]
Description=Amphitrite
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$(command -v pnpm) start
Restart=always
RestartSec=3
User=$RUN_USER
Group=$RUN_GROUP

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload

  if [[ "$START_SERVICE" == "true" ]]; then
    systemctl enable --now "${APP_NAME}.service"
    systemctl --no-pager --full status "${APP_NAME}.service" || true
  else
    echo "Systemd unit installed at $unit_path"
    echo "Start it with: sudo systemctl enable --now ${APP_NAME}.service"
  fi
}

main() {
  parse_args "$@"

  ensure_base_dependencies
  ensure_node_and_pnpm

  ensure_install_dir
  sync_code
  setup_env_file
  install_dependencies_and_build
  prepare_runtime_permissions

  if [[ "$ENABLE_SYSTEMD" == "true" ]]; then
    write_systemd_unit
  fi

  echo
  echo "Install complete."
  echo "App directory: $INSTALL_DIR"
  echo "Run manually:"
  echo "  cd $INSTALL_DIR"
  echo "  NODE_ENV=production PORT=$PORT pnpm start"
  echo
  echo "Before first run, edit $INSTALL_DIR/.env.local with real Poseidon credentials if needed."
}

main "$@"
