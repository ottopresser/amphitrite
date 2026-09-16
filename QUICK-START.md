# Amphitrite Quick Start

This guide covers automatic installation with `scripts/install.sh` and a manual installation. Run Amphitrite on a Linux system that can reach every Poseidon host.

## Before You Begin

Have the following information ready:

- Poseidon host URL, such as `http://vmhost1.example:8000`
- Poseidon API key or admin token
- A DNS name or IP address users will use to reach Amphitrite

The automatic installer supports `apt`, `dnf`, `yum`, `zypper`, and `pacman` when it needs to install prerequisites. Node.js 22 or newer is required.

## Automatic Installation

### Install from GitHub

From the Amphitrite repository root:

```bash
sudo ./scripts/install.sh --systemd --start
```

By default, the installer clones or updates `https://github.com/ottopresser/amphitrite.git` in `/opt/amphitrite`. It then installs locked dependencies, builds the frontend, installs `amphitrite.service`, and starts it on port `8787`.

To choose another path or port:

```bash
sudo ./scripts/install.sh \
  --install-dir /srv/amphitrite \
  --port 9000 \
  --systemd \
  --start
```

### Use Another Git Repository

Run the installer from any Amphitrite checkout and provide the repository URL:

```bash
sudo ./scripts/install.sh \
  --repo-url https://github.com/example/amphitrite.git \
  --install-dir /opt/amphitrite \
  --systemd \
  --start
```

`--repo-url` overrides the default GitHub source. To use files already present in the installation directory without cloning or pulling, pass `--skip-clone`.

### Configure and Open Amphitrite

The installer creates `.env.local` only when it does not already exist. Either edit the installed file:

```bash
sudoedit /opt/amphitrite/.env.local
sudo systemctl restart amphitrite
```

Or open **Settings** in Amphitrite and enter default credentials and hosts there.

Check the service:

```bash
sudo systemctl status amphitrite
sudo journalctl -u amphitrite -f
```

Open:

```text
http://AMPHITRITE_HOST:8787
```

Other installer options are available with:

```bash
./scripts/install.sh --help
```

## Manual Installation

### 1. Install Node.js and pnpm

Install Node.js 22 or newer, then activate the pinned pnpm release:

```bash
node --version
corepack enable
corepack prepare pnpm@11.5.2 --activate
pnpm --version
```

If Corepack is unavailable:

```bash
npm install --global pnpm@11.5.2
```

### 2. Install Amphitrite

From the repository root:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Edit `.env.local` and replace placeholder credentials and host URLs. A minimal single-host value is:

```env
POSEIDON_SERVERS=[{"id":"vmhost1","name":"vmhost1.example","baseUrl":"http://vmhost1.example:8000","headers":{"x-api-key":"replace-with-api-key"}}]
```

Build the production frontend:

```bash
pnpm build
```

### 3. Start Amphitrite

Run it directly:

```bash
NODE_ENV=production PORT=8787 pnpm start
```

Open `http://AMPHITRITE_HOST:8787`.

### 4. Optional Manual systemd Service

First determine the full pnpm path:

```bash
command -v pnpm
```

Create `/etc/systemd/system/amphitrite.service`, replacing `/path/to/pnpm` and the working directory as needed:

```ini
[Unit]
Description=Amphitrite
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/amphitrite
Environment=NODE_ENV=production
Environment=PORT=8787
ExecStart=/path/to/pnpm start
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Allow the service account to persist settings and read the local environment:

```bash
sudo install -d -o www-data -g www-data -m 750 /opt/amphitrite/data
sudo chown www-data:www-data /opt/amphitrite/.env.local
sudo chmod 600 /opt/amphitrite/.env.local
sudo systemctl daemon-reload
sudo systemctl enable --now amphitrite
```

## Updating

Update the checkout, then rebuild and restart:

```bash
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart amphitrite
```

The automatic installer updates an existing Git installation when run again with the same `--repo-url` and `--install-dir`. Without `--repo-url`, it pulls from `https://github.com/ottopresser/amphitrite.git`.

## Troubleshooting

- **Poseidon host shows an error:** Verify the host URL, credentials, and network access from the Amphitrite server.
- **Settings cannot be saved:** Verify the service user owns the installed `data/` directory.
- **Console does not connect:** Ensure the reverse proxy supports WebSocket upgrades and that the relevant Poseidon or VNC ports are reachable.
- **Port is already in use:** Set another port with `PORT` or the installer's `--port` option.
- **Changes to `.env.local` are ignored:** Saved `data/poseidon-servers.json` settings take precedence. Update the host in **Settings** or remove the saved file after making a backup.
- **Corepack reports `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`:** Pull the latest installer and run it again. The installer bypasses incompatible distro Corepack wrappers and installs the pinned pnpm CLI through npm.

## Security Notes

- Keep `.env.local`, `data/poseidon-servers.json`, and exported settings out of source control.
- Restrict access to port `8787` or place Amphitrite behind an authenticated TLS reverse proxy.
- Treat Poseidon API keys, admin tokens, and settings exports as secrets.