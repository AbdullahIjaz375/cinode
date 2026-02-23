# setup-pipeline

One-command CI/CD pipeline generator for Node.js projects. Zero dependencies.

Add GitHub Actions CI/CD, Docker, pre-commit hooks, and multi-platform deployment to any Node.js project in seconds.

## Quick Start

```bash
npx setup-pipeline
```

That's it. The CLI walks you through everything interactively.

## What It Does

```
npx setup-pipeline --yes --deploy docker --husky
```

One command adds:

- **5+ GitHub Actions workflows** (CI, deployment, CodeQL, dependency review)
- **7 parallel CI checks** (lint, build, test, security, duplication, code quality)
- **Pre-commit hooks** (Husky + lint-staged)
- **Docker support** (multi-stage Dockerfile, docker-compose, .dockerignore)
- **Deployment automation** for your platform of choice
- **Config files** (ESLint, Prettier, jscpd, PR template)

## Deployment Targets

| Target | Command | What It Does |
|--------|---------|--------------|
| **SSH/PM2** | `--deploy ssh` | SCP + PM2 restart with backup, health check, auto-rollback |
| **Docker** | `--deploy docker` | Build image, push to GHCR, optional SSH deploy |
| **Vercel** | `--deploy vercel` | Preview on PRs, production on push to main |
| **Railway** | `--deploy railway` | `railway up` via CLI |
| **Render** | `--deploy render` | Trigger deploy hook + generates `render.yaml` |
| **Fly.io** | `--deploy flyio` | `flyctl deploy` + generates `fly.toml` |
| **None** | `--deploy none` | CI checks only, no deployment |

## CI Pipeline (7 Parallel Checks)

Every PR to `dev` or `main` runs:

1. **Lint & Format** — ESLint + Prettier (auto-detects existing configs)
2. **Build Check** — `npm run build` or syntax validation
3. **Tests** — Auto-detects Jest/Mocha/Vitest
4. **Security** — npm audit + hardcoded secret detection + .env leak check
5. **Code Duplication** — jscpd finds copy-pasted blocks
6. **Code Quality** — Complexity analysis, large files, TODO/FIXME count, outdated deps
7. **PR Gate** — All checks must pass before merge

## Usage

### Interactive (recommended)

```bash
npx setup-pipeline
```

Asks you: deployment target, Node version, Husky, Docker, which CI checks, config files.

### Non-interactive

```bash
# All defaults (SSH/PM2, Node 20, no Husky, no Docker)
npx setup-pipeline --yes

# Docker deployment + Husky
npx setup-pipeline --yes --deploy docker --husky

# Vercel + Node 22
npx setup-pipeline --yes --deploy vercel --node 22

# Railway + Husky + Docker
npx setup-pipeline --yes --deploy railway --husky --docker

# Fly.io (Docker auto-added)
npx setup-pipeline --yes --deploy flyio

# CI checks only (no deployment)
npx setup-pipeline --yes --deploy none --husky

# Preview what would change
npx setup-pipeline --dry-run

# Target a specific directory
npx setup-pipeline /path/to/project --yes
```

### All Flags

```
--yes, -y              Accept all defaults
--dry-run              Preview without writing files
--node <version>       Node.js version (default: 20)
--deploy <target>      ssh, docker, vercel, railway, render, flyio, none
--docker               Add Dockerfile + docker-compose
--husky                Add Husky + lint-staged pre-commit hooks
--no-docker            Skip Docker
--no-husky             Skip Husky
--typescript, --ts     Force TypeScript mode
```

## Smart Detection

The CLI auto-detects your project:

| Detection | How |
|-----------|-----|
| **Project type** | Next.js, Express, NestJS, React (CRA/Vite), generic |
| **TypeScript** | `tsconfig.json` → adds TS ESLint parser + rules |
| **Package manager** | npm / yarn / pnpm → correct install commands in all workflows |
| **Existing configs** | Won't overwrite ESLint, Prettier, Docker, Husky if found |
| **Build script** | Runs `npm run build` if exists, otherwise syntax-checks JS files |
| **Test framework** | Detects Jest, Mocha, Vitest and runs accordingly |

## Files Added

### Workflows

| File | Trigger |
|------|---------|
| `ci.yml` | PRs to dev/main |
| `codeql.yml` | PRs + weekly |
| `dependency-review.yml` | PRs |
| `deploy-*.yml` | Push to dev/main (varies by target) |

### Docker (if enabled)

| File | Description |
|------|-------------|
| `Dockerfile` | Multi-stage production build (Next.js variant auto-detected) |
| `docker-compose.yml` | Local development |
| `.dockerignore` | Excludes node_modules, .git, .env, etc. |

### Pre-commit Hooks (if enabled)

| File | Description |
|------|-------------|
| `.husky/pre-commit` | Runs lint-staged on commit |
| `lint-staged` config | Inline in package.json (ESLint + Prettier on staged files) |

### Deployment Configs

| File | When |
|------|------|
| `fly.toml` | Fly.io deployment |
| `render.yaml` | Render deployment |

### Config Files

| File | Purpose |
|------|---------|
| `.eslintrc.json` | ESLint with complexity limits, security rules |
| `.prettierrc` + `.prettierignore` | Consistent formatting |
| `.jscpd.json` | Code duplication thresholds |
| `.github/PULL_REQUEST_TEMPLATE.md` | Standardized PR checklist |
| `PIPELINE.md` | Full setup documentation |

### package.json Scripts

```json
{
  "lint": "eslint . --ext .js --max-warnings 0",
  "lint:fix": "eslint . --ext .js --fix",
  "format": "prettier --write \"**/*.{js,json,md}\"",
  "format:check": "prettier --check \"**/*.{js,json,md}\"",
  "audit:security": "npm audit --production --audit-level=high",
  "check:duplicates": "npx jscpd .",
  "validate": "npm run lint && npm run format:check && npm run audit:security",
  "prepare": "husky install"
}
```

## GitHub Secrets Reference

### SSH/PM2

| Secret | Required |
|--------|----------|
| `DEV_SSH_HOST` | Yes |
| `DEV_SSH_USER` | Yes |
| `DEV_SSH_KEY` | Yes |
| `DEV_DEPLOY_PATH` | Yes |
| `DEV_PM2_APP_NAME` | Yes |

Same with `PROD_` prefix for production.

### Docker

No secrets needed for GHCR (uses `GITHUB_TOKEN`). For remote deploy, add SSH secrets.

### Vercel

| Secret | Required |
|--------|----------|
| `VERCEL_TOKEN` | Yes |
| `VERCEL_ORG_ID` | Yes |
| `VERCEL_PROJECT_ID` | Yes |

Run `npx vercel link` locally to get org/project IDs.

### Railway

| Secret | Required |
|--------|----------|
| `RAILWAY_TOKEN` | Yes |

### Render

| Secret | Required |
|--------|----------|
| `RENDER_DEPLOY_HOOK_URL` | Yes |

Get from Render dashboard > Service > Settings > Deploy Hook.

### Fly.io

| Secret | Required |
|--------|----------|
| `FLY_API_TOKEN` | Yes |

## Branching Strategy

```
Feature Branch --> PR to dev --> CI Checks --> Merge --> Deploy Dev
                                                            |
                  PR to main --> CI Checks --> Merge --> Deploy Prod
```

## Cost

**100% free.** No paid tokens, subscriptions, or third-party services.

| Tool | Cost |
|------|------|
| GitHub Actions | Free (2,000 min/month private, unlimited public) |
| CodeQL | Free |
| ESLint / Prettier / jscpd | Free (open source) |
| npm audit | Free (built into npm) |
| Husky / lint-staged | Free (open source) |

## License

MIT
