# Amphitrite

Amphitrite is a web control surface for Poseidon-managed FreeBSD bhyve hosts. A React frontend provides fleet and VM operations while an Express server proxies Poseidon requests, keeps credentials out of the browser, and bridges console connections.

For installation instructions, see [QUICK-START.md](QUICK-START.md).

## Features

- Multi-host health, readiness, resource summaries, and VM inventory
- Live VM metrics refreshed every 10 seconds while the Info tab is open
- VM start, stop, restart, configuration, cloning, snapshots, and deletion
- Virtual disk creation, existing IMG attachment, and data-preserving detach
- Uploaded ISO attachment as removable media and safe media detach
- Boot-media upload, inventory, checksum support, and deletion
- Host network inventory and Poseidon operation history
- Browser serial console and noVNC console support
- In-app host and default-credential management with import and export
- Persistent light and dark themes
- Responsive desktop and mobile interface

## Architecture

The Vite frontend calls Amphitrite's `/api` routes. The Express server applies the configured Poseidon credentials and forwards requests to the selected host. Poseidon credentials are never sent to the browser.

In production, the Express server also serves the compiled frontend from `dist/`. The default port is `8787`.

## Requirements

- Linux host for Amphitrite
- Node.js 22 or newer
- pnpm 11.5.2, as declared by `packageManager`
- Network access from Amphitrite to each Poseidon host
- A Poseidon API key or admin token with the required permissions
- A modern browser with WebSocket support

## Configuration

Copy the example environment file:

```bash
cp .env.example .env.local
```

Define one or more Poseidon hosts in `POSEIDON_SERVERS`:

```env
POSEIDON_SERVERS=[{"id":"vmhost1","name":"vmhost1.home.lan","baseUrl":"http://vmhost1.home.lan:8000","headers":{"x-api-key":"replace-with-api-key","x-admin-token":"optional-admin-token"}}]
```

Each host accepts:

- `id`: Stable identifier used in Amphitrite routes.
- `name`: Display name shown in the fleet.
- `baseUrl`: Poseidon URL without a trailing slash.
- `headers`: Optional `x-api-key` and `x-admin-token` values.

Hosts and default credentials can also be managed from **Settings**. In-app settings are stored in `data/poseidon-servers.json`. Once that file exists, its server list takes precedence over `POSEIDON_SERVERS`.

### Security

`.env.local` and `data/poseidon-servers.json` may contain plaintext credentials. Restrict their filesystem permissions, exclude them from source control, and rotate credentials that are accidentally disclosed. Settings exports also include credentials and must be handled as secrets.

## Development

```bash
corepack enable
corepack prepare pnpm@11.5.2 --activate
pnpm install --frozen-lockfile
pnpm dev
```

The frontend runs at `http://localhost:5173` and proxies `/api` and WebSocket traffic to the Express server at `http://127.0.0.1:8787`.

## Production

```bash
pnpm install --frozen-lockfile
pnpm build
NODE_ENV=production PORT=8787 pnpm start
```

Open `http://HOSTNAME:8787`. Place Amphitrite behind a TLS reverse proxy when it is accessible outside a trusted network, and enable WebSocket proxying for console support.

## API Coverage

Amphitrite supports the current Poseidon API surface:

- Service: `/health`, `/ready`
- Hosts: `/v1/host/summary`, `/v1/networks`, `/v1/operations`
- Fleet: `/v1/vms`, `/v1/vms/metrics`, `/v1/vms/create`
- VM lifecycle: info, config, configure, start, stop, restart, and delete
- VM metrics: `/v1/vms/{vm_name}/metrics`
- Consoles: console action, console token, serial WebSocket, and proxied VNC
- Snapshots: list, create, rollback, and delete
- Cloning: `/v1/vms/{vm_name}/clone`
- Disks: inventory, create, and data-preserving detach
- Removable media: detach plus guarded Amphitrite adapters for uploaded ISO and IMG attachment
- Boot media: list, upload, and delete

The ISO and IMG attach routes are Amphitrite adapters. They validate files against the selected host's uploaded-media inventory and apply indexed disk settings through Poseidon's configure endpoint.

## Project Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the frontend and server in watch mode |
| `pnpm build` | Type-check and create the production frontend |
| `pnpm start` | Run the Express server |
| `pnpm preview` | Preview the Vite production build only |

## Installation Script

`scripts/install.sh` clones or updates [ottopresser/amphitrite](https://github.com/ottopresser/amphitrite) by default, installs dependencies, builds Amphitrite, and optionally creates and starts a systemd service. Use `--repo-url` to select another Git repository or `--skip-clone` to use an existing installation directory.

```bash
./scripts/install.sh --help
```

When systemd is enabled, the installer validates the service account, grants it write access to `data/`, and restricts `.env.local` to that account.
