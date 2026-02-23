# CI/CD Pipeline Documentation

Reusable GitHub Actions pipeline for Node.js projects.

## Pipeline Overview

```
Feature Branch → PR to dev → CI Checks → Merge to dev → Deploy Dev
                                                            ↓
                              PR to main → CI Checks → Merge to main → Deploy Prod
```

## Workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| **CI Pipeline** | `ci.yml` | PR to dev/main, push to dev | Linting, build, tests, security, duplication, code quality |
| **Deploy Dev** | `deploy-dev.yml` | Push to dev | SSH deploy to dev server with PM2 |
| **Deploy Prod** | `deploy-prod.yml` | Push to main | SSH deploy to prod with approval gate |
| **CodeQL** | `codeql.yml` | PRs + weekly schedule | GitHub security analysis |
| **Dependency Review** | `dependency-review.yml` | PRs | Check new deps for vulnerabilities |

## CI Pipeline Checks (ci.yml)

1. **Lint & Format** - ESLint + Prettier (auto-detects if configured)
2. **Build Check** - Runs `npm run build` or syntax-checks all JS files
3. **Tests** - Runs `npm test` if configured (Jest/Mocha/Vitest)
4. **Security Scan** - `npm audit`, hardcoded secret detection, .env file check
5. **Code Duplication** - jscpd detects copy-pasted code blocks
6. **Code Quality** - Complexity analysis, large file detection, TODO/FIXME count, outdated deps
7. **PR Gate** - All checks must pass before merge

## Setup for a New Project

### 1. Copy files

```bash
# From a project that already has the pipeline:
cp -r .github/ /path/to/new-project/.github/
cp .eslintrc.json .prettierrc .prettierignore .jscpd.json /path/to/new-project/
```

### 2. Add devDependencies

```bash
cd /path/to/new-project
npm install --save-dev eslint prettier
```

### 3. Add scripts to package.json

```json
{
  "scripts": {
    "lint": "eslint . --ext .js,.ts --max-warnings 0",
    "lint:fix": "eslint . --ext .js,.ts --fix",
    "format": "prettier --write \"**/*.{js,ts,json,md}\"",
    "format:check": "prettier --check \"**/*.{js,ts,json,md}\"",
    "validate": "npm run lint && npm run format:check && npm run audit:security",
    "audit:security": "npm audit --production --audit-level=high",
    "check:duplicates": "npx jscpd ."
  }
}
```

### 4. Configure GitHub Secrets

Go to **repo Settings > Secrets and variables > Actions** and add:

#### Dev Environment
| Secret | Description | Example |
|--------|-------------|---------|
| `DEV_SSH_HOST` | Dev server IP/hostname | `56.228.32.244` |
| `DEV_SSH_USER` | SSH username | `ubuntu` |
| `DEV_SSH_KEY` | SSH private key (full content) | `-----BEGIN OPENSSH...` |
| `DEV_SSH_PORT` | SSH port (optional) | `22` |
| `DEV_DEPLOY_PATH` | App directory on server | `/home/ubuntu/my-app` |
| `DEV_PM2_APP_NAME` | PM2 process name | `my-app-dev` |
| `DEV_PORT` | App port (for health check) | `5000` |
| `DEV_ENV_FILE` | Base64 .env (optional) | `base64 -i .env` |

#### Prod Environment
Same as dev but prefixed with `PROD_` instead of `DEV_`.

Additional prod secrets:
| Secret | Description |
|--------|-------------|
| `SLACK_WEBHOOK_URL` | Slack notifications (optional) |

#### How to base64 encode your .env:
```bash
base64 -i .env    # macOS
base64 .env        # Linux
```

### 5. Create GitHub Environments (optional but recommended)

Go to **repo Settings > Environments**:
- Create `development` environment
- Create `production` environment with **required reviewers** (adds approval gate)

### 6. Create dev branch

```bash
git checkout -b dev
git push -u origin dev
```

### 7. Set branch protection rules

Go to **repo Settings > Branches > Add rule**:

**For `dev` branch:**
- Require pull request before merging
- Require status checks: `PR Gate`
- Require branches to be up to date

**For `main` branch:**
- Require pull request before merging
- Require status checks: `PR Gate`
- Require branches to be up to date
- Require approvals: 1+

## Workflow: Day-to-Day Development

```bash
# 1. Create feature branch from dev
git checkout dev && git pull
git checkout -b feature/my-feature

# 2. Work on your feature, commit
git add . && git commit -m "Add my feature"
git push -u origin feature/my-feature

# 3. Create PR to dev (CI runs automatically)
gh pr create --base dev --title "Add my feature"

# 4. CI checks run → fix any issues → merge PR
# 5. deploy-dev.yml auto-deploys to dev server

# 6. When ready for production:
gh pr create --base main --head dev --title "Release: v1.x.x"

# 7. CI checks run → approve → merge
# 8. deploy-prod.yml auto-deploys to production
```

## Cost

**Everything in this pipeline is 100% free.** No paid tokens, subscriptions, or third-party services required.

| Tool | Cost | Notes |
|------|------|-------|
| GitHub Actions | Free | 2,000 min/month for private repos, unlimited for public |
| CodeQL | Free | GitHub's own security scanner |
| Dependency Review | Free | GitHub's own action |
| ESLint / Prettier | Free | Open source |
| jscpd | Free | Open source |
| npm audit | Free | Built into npm |
| Slack Webhooks | Free | Optional, Slack's free tier covers it |

## Customization

### Change Node version
Edit `NODE_VERSION` env in each workflow file:
```yaml
env:
  NODE_VERSION: "22"  # Change from 20 to 22
```

### Docker deployment (instead of SSH/PM2)
Replace the deploy steps with Docker build & push. See sportx-backend for reference.

### TypeScript projects
The pipeline auto-detects TypeScript. Just ensure `npm run build` compiles TS.
ESLint config for TS:
```bash
npm install --save-dev @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CI fails on lint | Run `npm run lint:fix` locally |
| CI fails on format | Run `npm run format` locally |
| Deploy fails SSH | Verify `SSH_KEY` secret has full private key content |
| Health check fails | Ensure app has a `/health` endpoint or remove the check |
| npm audit fails | Run `npm audit fix` or `npm audit fix --force` locally |
| jscpd threshold exceeded | Refactor duplicated code or adjust threshold in `.jscpd.json` |
