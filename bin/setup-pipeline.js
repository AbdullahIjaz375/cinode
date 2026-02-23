#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// =============================================================================
// 1. CONSTANTS & CONFIGURATION
// =============================================================================

const VERSION = "2.0.0";
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

const DEPLOYMENT_TARGETS = {
  ssh: {
    label: "SSH/PM2 (VPS, EC2, DigitalOcean)",
    workflows: ["deploy-dev.yml", "deploy-prod.yml"],
    secrets: ["DEV_SSH_HOST", "DEV_SSH_USER", "DEV_SSH_KEY", "DEV_DEPLOY_PATH", "DEV_PM2_APP_NAME"],
    needsDocker: false,
  },
  docker: {
    label: "Docker (GitHub Container Registry)",
    workflows: ["deploy-docker.yml"],
    secrets: ["(none - uses GITHUB_TOKEN)", "Optional: DEPLOY_SSH_HOST for remote deploy"],
    needsDocker: true,
  },
  vercel: {
    label: "Vercel (Next.js / frontend)",
    workflows: ["deploy-vercel.yml"],
    secrets: ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"],
    needsDocker: false,
  },
  railway: {
    label: "Railway",
    workflows: ["deploy-railway.yml"],
    secrets: ["RAILWAY_TOKEN"],
    needsDocker: false,
  },
  render: {
    label: "Render",
    workflows: ["deploy-render.yml"],
    secrets: ["RENDER_DEPLOY_HOOK_URL"],
    needsDocker: false,
  },
  flyio: {
    label: "Fly.io (edge deployment)",
    workflows: ["deploy-flyio.yml"],
    secrets: ["FLY_API_TOKEN"],
    needsDocker: true,
  },
  none: {
    label: "None (CI checks only)",
    workflows: [],
    secrets: [],
    needsDocker: false,
  },
};

const PKG_MANAGERS = {
  npm: {
    lockfile: "package-lock.json",
    install: "npm ci",
    cache: "npm",
    run: "npm run",
    exec: "npx",
  },
  yarn: {
    lockfile: "yarn.lock",
    install: "yarn install --frozen-lockfile",
    cache: "yarn",
    run: "yarn",
    exec: "yarn dlx",
  },
  pnpm: {
    lockfile: "pnpm-lock.yaml",
    install: "pnpm install --frozen-lockfile",
    cache: "pnpm",
    run: "pnpm run",
    exec: "pnpm dlx",
  },
};

const PNPM_SETUP_STEP = `      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest

`;

const CI_CHECKS = {
  lint: { label: "Lint & Format", jobName: "lint" },
  build: { label: "Build Check", jobName: "build" },
  test: { label: "Tests", jobName: "test" },
  security: { label: "Security Scan", jobName: "security" },
  duplication: { label: "Code Duplication", jobName: "duplication" },
  "code-quality": { label: "Code Quality & Debt", jobName: "code-quality" },
};

// =============================================================================
// 2. UTILITY FUNCTIONS
// =============================================================================

function createRL() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, defaultVal) {
  const suffix = defaultVal ? ` ${c("dim", `(${defaultVal})`)}` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

function askYN(rl, question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`  ${question} ${c("dim", `(${hint})`)}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

function askSelect(rl, question, options) {
  return new Promise((resolve) => {
    console.log(`  ${question}`);
    const keys = Object.keys(options);
    keys.forEach((key, i) => {
      console.log(`    ${c("cyan", `${i + 1})`)} ${options[key]}`);
    });
    rl.question(`  ${c("dim", "Choice")} ${c("dim", "(1)")}: `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < keys.length) resolve(keys[idx]);
      else resolve(keys[0]);
    });
  });
}

function askMultiSelect(rl, question, options, defaultAll = true) {
  return new Promise((resolve) => {
    const keys = Object.keys(options);
    const selected = new Set(defaultAll ? keys : []);

    console.log(`  ${question}`);
    keys.forEach((key, i) => {
      const check = selected.has(key) ? c("green", "[x]") : "[ ]";
      console.log(`    ${check} ${c("cyan", `${i + 1})`)} ${options[key]}`);
    });
    rl.question(`  ${c("dim", "Toggle (comma-separated) or Enter to confirm")}: `, (answer) => {
      const input = answer.trim();
      if (input === "") {
        resolve(Array.from(selected));
        return;
      }
      input.split(",").forEach((n) => {
        const idx = parseInt(n.trim(), 10) - 1;
        if (idx >= 0 && idx < keys.length) {
          const key = keys[idx];
          if (selected.has(key)) selected.delete(key);
          else selected.add(key);
        }
      });
      resolve(Array.from(selected));
    });
  });
}

function fileExists(p) {
  return fs.existsSync(p);
}

function replaceTemplatePlaceholders(content, replacements) {
  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(key).join(value);
  }
  return result;
}

function printBanner() {
  console.log("");
  console.log(c("bold", c("cyan", "  ================================================================")));
  console.log(c("bold", c("cyan", "    setup-pipeline v" + VERSION + " - CI/CD Pipeline Generator")));
  console.log(c("bold", c("cyan", "  ================================================================")));
  console.log("");
  console.log(c("dim", "  GitHub Actions CI/CD, linting, security, duplication checks,"));
  console.log(c("dim", "  Docker, pre-commit hooks, and multi-platform deployment."));
  console.log("");
}

// =============================================================================
// 3. DETECTION FUNCTIONS
// =============================================================================

function detectPackageManager(projectDir) {
  if (fileExists(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fileExists(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectProjectType(projectDir) {
  if (
    fileExists(path.join(projectDir, "next.config.js")) ||
    fileExists(path.join(projectDir, "next.config.mjs")) ||
    fileExists(path.join(projectDir, "next.config.ts"))
  )
    return "nextjs";

  const pkgPath = path.join(projectDir, "package.json");
  if (!fileExists(pkgPath)) return "generic";

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps["@nestjs/core"]) return "nestjs";
    if (deps["react-scripts"]) return "react-cra";
    if (deps["vite"] && deps["react"]) return "react-vite";
    if (deps["express"]) return "express";
  } catch {}

  return "generic";
}

function detectProject(projectDir) {
  const pkgPath = path.join(projectDir, "package.json");
  const hasPkg = fileExists(pkgPath);
  let appName = "my-app";
  let entryPoint = "server.js";

  if (hasPkg) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      appName = pkg.name || "my-app";
      entryPoint = pkg.main || "server.js";
    } catch {}
  }

  return {
    hasPkg,
    appName,
    entryPoint,
    isTypeScript:
      fileExists(path.join(projectDir, "tsconfig.json")) ||
      fileExists(path.join(projectDir, "tsconfig.build.json")),
    projectType: detectProjectType(projectDir),
    packageManager: detectPackageManager(projectDir),
    hasExistingGH: fileExists(path.join(projectDir, ".github", "workflows")),
    hasExistingEslint:
      fileExists(path.join(projectDir, ".eslintrc.json")) ||
      fileExists(path.join(projectDir, ".eslintrc.js")) ||
      fileExists(path.join(projectDir, "eslint.config.js")) ||
      fileExists(path.join(projectDir, "eslint.config.mjs")),
    hasExistingPrettier:
      fileExists(path.join(projectDir, ".prettierrc")) ||
      fileExists(path.join(projectDir, ".prettierrc.json")) ||
      fileExists(path.join(projectDir, "prettier.config.js")),
    hasExistingDocker: fileExists(path.join(projectDir, "Dockerfile")),
    hasExistingHusky: fileExists(path.join(projectDir, ".husky")),
  };
}

const PROJECT_TYPE_LABELS = {
  nextjs: "Next.js",
  express: "Express",
  nestjs: "NestJS",
  "react-cra": "React (CRA)",
  "react-vite": "React (Vite)",
  generic: "Node.js",
};

// =============================================================================
// 4. INTERACTIVE PROMPTS
// =============================================================================

async function runInteractivePrompts(rl, detection) {
  const config = {
    deployTarget: "ssh",
    nodeVersion: "20",
    addHusky: true,
    addDocker: false,
    ciChecks: Object.keys(CI_CHECKS),
    copyEslint: !detection.hasExistingEslint,
    copyPrettier: !detection.hasExistingPrettier,
    copyJscpd: true,
    copyPRTemplate: true,
    copyPipelineMd: true,
    updatePkg: detection.hasPkg,
  };

  // Section: Deployment
  console.log(c("dim", "  -- Deployment -------------------------------------------------"));
  console.log("");

  const deployOptions = {};
  for (const [key, val] of Object.entries(DEPLOYMENT_TARGETS)) {
    deployOptions[key] = val.label;
  }
  config.deployTarget = await askSelect(rl, "Deployment target?", deployOptions);

  console.log("");
  config.nodeVersion = await ask(rl, "Node.js version", "20");

  // Section: Pre-commit hooks
  console.log("");
  console.log(c("dim", "  -- Pre-commit Hooks -------------------------------------------"));
  console.log("");

  if (detection.hasExistingHusky) {
    config.addHusky = await askYN(rl, "Existing Husky found. Overwrite?", false);
  } else {
    config.addHusky = await askYN(rl, "Add pre-commit hooks (Husky + lint-staged)?", true);
  }

  // Section: Docker
  console.log("");
  console.log(c("dim", "  -- Docker ----------------------------------------------------"));
  console.log("");

  if (DEPLOYMENT_TARGETS[config.deployTarget].needsDocker) {
    config.addDocker = true;
    console.log(c("green", "  Docker support will be added (required for this deployment target)."));
  } else if (detection.hasExistingDocker) {
    config.addDocker = await askYN(rl, "Existing Dockerfile found. Overwrite?", false);
  } else {
    config.addDocker = await askYN(rl, "Add Docker support (Dockerfile + docker-compose)?", false);
  }

  // Section: CI Checks
  console.log("");
  console.log(c("dim", "  -- CI Checks -------------------------------------------------"));
  console.log("");

  const checkOptions = {};
  for (const [key, val] of Object.entries(CI_CHECKS)) {
    checkOptions[key] = val.label;
  }
  config.ciChecks = await askMultiSelect(rl, "CI checks to enable? (all on by default)", checkOptions, true);

  // Section: Config Files
  console.log("");
  console.log(c("dim", "  -- Config Files -----------------------------------------------"));
  console.log("");

  config.copyEslint = await askYN(
    rl,
    detection.hasExistingEslint ? "Existing ESLint config found. Overwrite?" : "Add ESLint config?",
    !detection.hasExistingEslint
  );

  config.copyPrettier = await askYN(
    rl,
    detection.hasExistingPrettier ? "Existing Prettier config found. Overwrite?" : "Add Prettier config?",
    !detection.hasExistingPrettier
  );

  config.copyJscpd = await askYN(rl, "Add jscpd (code duplication) config?", true);
  config.copyPRTemplate = await askYN(rl, "Add PR template?", true);
  config.copyPipelineMd = await askYN(rl, "Add PIPELINE.md documentation?", true);

  if (detection.hasPkg) {
    config.updatePkg = await askYN(rl, "Update package.json with scripts & devDependencies?", true);
  }

  return config;
}

function buildDefaultConfig(detection, args) {
  const deployFlag = getArgValue(args, "--deploy") || getArgValue(args, "-d");
  const deployTarget = deployFlag && DEPLOYMENT_TARGETS[deployFlag] ? deployFlag : "ssh";

  const hasHuskyFlag = args.includes("--husky");
  const hasNoHuskyFlag = args.includes("--no-husky");
  const hasDockerFlag = args.includes("--docker");
  const hasNoDockerFlag = args.includes("--no-docker");

  return {
    deployTarget,
    nodeVersion: getArgValue(args, "--node") || "20",
    addHusky: hasHuskyFlag ? true : hasNoHuskyFlag ? false : false,
    addDocker:
      hasDockerFlag || DEPLOYMENT_TARGETS[deployTarget].needsDocker
        ? true
        : hasNoDockerFlag
          ? false
          : false,
    ciChecks: Object.keys(CI_CHECKS),
    copyEslint: !detection.hasExistingEslint,
    copyPrettier: !detection.hasExistingPrettier,
    copyJscpd: true,
    copyPRTemplate: true,
    copyPipelineMd: true,
    updatePkg: detection.hasPkg,
  };
}

function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

// =============================================================================
// 5. TEMPLATE ENGINE
// =============================================================================

function buildReplacements(config, detection) {
  const pm = PKG_MANAGERS[detection.packageManager];
  return {
    __NODE_VERSION__: config.nodeVersion,
    __PKG_INSTALL_CMD__: pm.install,
    __PKG_CACHE__: pm.cache,
    __APP_NAME__: detection.appName,
    __ENTRY_POINT__: detection.entryPoint || "server.js",
    __PNPM_SETUP__: detection.packageManager === "pnpm" ? PNPM_SETUP_STEP : "",
  };
}

function processTemplate(srcPath, replacements) {
  const content = fs.readFileSync(srcPath, "utf8");
  return replaceTemplatePlaceholders(content, replacements);
}

function writeTemplate(srcPath, destPath, replacements, actions) {
  const content = processTemplate(srcPath, replacements);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content);
  const relPath = path.relative(process.cwd(), destPath);
  actions.push(relPath);
  console.log(c("green", `  + ${relPath}`));
}

function copyTemplateFile(srcPath, destPath, actions) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  const relPath = path.relative(process.cwd(), destPath);
  actions.push(relPath);
  console.log(c("green", `  + ${relPath}`));
}

// =============================================================================
// 6. PACKAGE.JSON MODIFIER
// =============================================================================

function updatePackageJson(projectDir, config, detection) {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fileExists(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg.scripts) pkg.scripts = {};
  if (!pkg.devDependencies) pkg.devDependencies = {};

  const isTS = detection.isTypeScript;
  const ext = isTS ? ".js,.ts,.jsx,.tsx" : ".js,.jsx";
  const fmtGlob = isTS ? "**/*.{js,ts,jsx,tsx,json,md}" : "**/*.{js,jsx,json,md}";

  const scriptsToAdd = {
    lint: `eslint . --ext ${ext} --max-warnings 0`,
    "lint:fix": `eslint . --ext ${ext} --fix`,
    format: `prettier --write "${fmtGlob}"`,
    "format:check": `prettier --check "${fmtGlob}"`,
    "audit:security": "npm audit --production --audit-level=high",
    "check:duplicates": "npx jscpd .",
    validate: "npm run lint && npm run format:check && npm run audit:security",
  };

  if (config.addHusky) {
    scriptsToAdd.prepare = "husky install";
  }

  const addedScripts = [];
  for (const [name, cmd] of Object.entries(scriptsToAdd)) {
    if (!pkg.scripts[name]) {
      pkg.scripts[name] = cmd;
      addedScripts.push(name);
    }
  }

  const depsToAdd = {
    eslint: "^8.57.0",
    prettier: "^3.3.0",
  };

  if (isTS) {
    depsToAdd["@typescript-eslint/parser"] = "^7.0.0";
    depsToAdd["@typescript-eslint/eslint-plugin"] = "^7.0.0";
  }

  if (config.addHusky) {
    depsToAdd["husky"] = "^9.0.0";
    depsToAdd["lint-staged"] = "^15.0.0";
  }

  const addedDeps = [];
  for (const [name, version] of Object.entries(depsToAdd)) {
    const inDeps = pkg.dependencies && pkg.dependencies[name];
    const inDevDeps = pkg.devDependencies[name];
    if (!inDeps && !inDevDeps) {
      pkg.devDependencies[name] = version;
      addedDeps.push(name);
    }
  }

  // lint-staged config inline
  if (config.addHusky && !pkg["lint-staged"]) {
    const lintPattern = isTS ? "*.{js,jsx,ts,tsx}" : "*.{js,jsx}";
    pkg["lint-staged"] = {
      [lintPattern]: ["eslint --fix", "prettier --write"],
      "*.{json,md,yml,yaml}": ["prettier --write"],
    };
    console.log(c("green", "  + Added lint-staged config to package.json"));
  }

  // Sort devDependencies
  pkg.devDependencies = Object.fromEntries(
    Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b))
  );

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  if (addedScripts.length > 0) {
    console.log(c("green", `  + Added scripts: ${addedScripts.join(", ")}`));
  }
  if (addedDeps.length > 0) {
    console.log(c("green", `  + Added devDependencies: ${addedDeps.join(", ")}`));
  }
}

// =============================================================================
// 7. FILE GENERATORS
// =============================================================================

function copyWorkflows(projectDir, config, detection, replacements, actions) {
  const workflowsDir = path.join(projectDir, ".github", "workflows");
  fs.mkdirSync(workflowsDir, { recursive: true });

  // Always copy CI + CodeQL + dependency review
  const universalWorkflows = ["ci.yml", "codeql.yml", "dependency-review.yml"];
  for (const file of universalWorkflows) {
    const src = path.join(TEMPLATES_DIR, ".github", "workflows", file);
    const dest = path.join(workflowsDir, file);
    if (file === "ci.yml") {
      let content = processTemplate(src, replacements);
      content = customizeCIChecks(content, config.ciChecks);
      fs.writeFileSync(dest, content);
      const relPath = path.relative(process.cwd(), dest);
      actions.push(relPath);
      console.log(c("green", `  + ${relPath}`));
    } else {
      copyTemplateFile(src, dest, actions);
    }
  }

  // Copy deployment-specific workflows
  const target = DEPLOYMENT_TARGETS[config.deployTarget];
  for (const file of target.workflows) {
    const src = path.join(TEMPLATES_DIR, ".github", "workflows", file);
    const dest = path.join(workflowsDir, file);
    if (fileExists(src)) {
      writeTemplate(src, dest, replacements, actions);
    }
  }
}

function customizeCIChecks(ciContent, enabledChecks) {
  const allChecks = Object.keys(CI_CHECKS);
  const disabledChecks = allChecks.filter((ch) => !enabledChecks.includes(ch));

  if (disabledChecks.length === 0) return ciContent;

  let content = ciContent;
  const lines = content.split("\n");

  // Find job boundaries using the numbered banner comments
  for (const check of disabledChecks) {
    const jobName = CI_CHECKS[check].jobName;
    const jobStartRegex = new RegExp(`^  ${jobName}:`);
    let startLine = -1;
    let bannerStart = -1;
    let endLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (jobStartRegex.test(lines[i])) {
        startLine = i;
        // Find the banner above (3 lines: # ===, # N. TITLE, # ===)
        bannerStart = i - 3;
        if (bannerStart < 0) bannerStart = i;
      }
      // Find the next job (next banner)
      if (startLine !== -1 && i > startLine && /^  # =====/.test(lines[i])) {
        endLine = i;
        break;
      }
    }

    if (startLine !== -1) {
      if (endLine === -1) endLine = lines.length;
      // Remove lines
      lines.splice(bannerStart, endLine - bannerStart);
    }
  }

  content = lines.join("\n");

  // Update pr-gate needs array
  const enabledJobNames = enabledChecks.map((ch) => CI_CHECKS[ch].jobName);
  content = content.replace(
    /needs: \[.*?\]/,
    `needs: [${enabledJobNames.join(", ")}]`
  );

  // Update pr-gate summary
  const summaryLines = enabledChecks
    .map((ch) => `          echo "  + ${CI_CHECKS[ch].label}"`)
    .join("\n");

  content = content.replace(
    /echo "  .*Linting & Formatting"[\s\S]*?echo "  .*Code Quality & Debt Analysis"/,
    summaryLines
  );

  return content;
}

function generateDockerFiles(projectDir, config, detection, replacements, actions) {
  if (!config.addDocker) return;

  const dockerfileSrc =
    detection.projectType === "nextjs"
      ? path.join(TEMPLATES_DIR, "docker", "Dockerfile.nextjs")
      : path.join(TEMPLATES_DIR, "docker", "Dockerfile");

  writeTemplate(dockerfileSrc, path.join(projectDir, "Dockerfile"), replacements, actions);
  writeTemplate(
    path.join(TEMPLATES_DIR, "docker", "docker-compose.yml"),
    path.join(projectDir, "docker-compose.yml"),
    replacements,
    actions
  );
  copyTemplateFile(
    path.join(TEMPLATES_DIR, "docker", ".dockerignore"),
    path.join(projectDir, ".dockerignore"),
    actions
  );
}

function generateDeploymentConfigs(projectDir, config, detection, replacements, actions) {
  if (config.deployTarget === "flyio") {
    writeTemplate(
      path.join(TEMPLATES_DIR, "deployment", "fly.toml"),
      path.join(projectDir, "fly.toml"),
      replacements,
      actions
    );
  }

  if (config.deployTarget === "render") {
    writeTemplate(
      path.join(TEMPLATES_DIR, "deployment", "render.yaml"),
      path.join(projectDir, "render.yaml"),
      replacements,
      actions
    );
  }
}

function setupHusky(projectDir, config, actions) {
  if (!config.addHusky) return;

  const huskyDir = path.join(projectDir, ".husky");
  fs.mkdirSync(huskyDir, { recursive: true });

  const preCommitSrc = path.join(TEMPLATES_DIR, "husky", "pre-commit");
  const preCommitDest = path.join(huskyDir, "pre-commit");

  copyTemplateFile(preCommitSrc, preCommitDest, actions);

  try {
    fs.chmodSync(preCommitDest, "755");
  } catch {}
}

function copyConfigFiles(projectDir, config, detection, replacements, actions) {
  if (config.copyEslint) {
    const src = path.join(TEMPLATES_DIR, ".eslintrc.json");
    const dest = path.join(projectDir, ".eslintrc.json");
    fs.copyFileSync(src, dest);

    if (detection.isTypeScript) {
      const eslintConfig = JSON.parse(fs.readFileSync(dest, "utf8"));
      eslintConfig.parser = "@typescript-eslint/parser";
      if (!eslintConfig.plugins) eslintConfig.plugins = [];
      if (!eslintConfig.plugins.includes("@typescript-eslint")) {
        eslintConfig.plugins.push("@typescript-eslint");
      }
      if (typeof eslintConfig.extends === "string") eslintConfig.extends = [eslintConfig.extends];
      if (!eslintConfig.extends.includes("plugin:@typescript-eslint/recommended")) {
        eslintConfig.extends.push("plugin:@typescript-eslint/recommended");
      }
      fs.writeFileSync(dest, JSON.stringify(eslintConfig, null, 2) + "\n");
    }

    const relPath = path.relative(process.cwd(), dest);
    actions.push(relPath);
    console.log(c("green", `  + ${relPath}`) + (detection.isTypeScript ? c("green", " (TypeScript)") : ""));
  }

  if (config.copyPrettier) {
    copyTemplateFile(path.join(TEMPLATES_DIR, ".prettierrc"), path.join(projectDir, ".prettierrc"), actions);
    copyTemplateFile(path.join(TEMPLATES_DIR, ".prettierignore"), path.join(projectDir, ".prettierignore"), actions);
  }

  if (config.copyJscpd) {
    copyTemplateFile(path.join(TEMPLATES_DIR, ".jscpd.json"), path.join(projectDir, ".jscpd.json"), actions);
  }

  if (config.copyPRTemplate) {
    copyTemplateFile(
      path.join(TEMPLATES_DIR, ".github", "PULL_REQUEST_TEMPLATE.md"),
      path.join(projectDir, ".github", "PULL_REQUEST_TEMPLATE.md"),
      actions
    );
  }

  if (config.copyPipelineMd) {
    copyTemplateFile(path.join(TEMPLATES_DIR, "PIPELINE.md"), path.join(projectDir, "PIPELINE.md"), actions);
  }
}

// =============================================================================
// 8. DRY-RUN REPORTER
// =============================================================================

function reportDryRun(config, detection) {
  console.log("");
  console.log(c("bold", c("yellow", "  DRY RUN - No files were modified")));
  console.log("");
  console.log(c("bold", "  Configuration:"));
  console.log(`    Deployment:       ${DEPLOYMENT_TARGETS[config.deployTarget].label}`);
  console.log(`    Node version:     ${config.nodeVersion}`);
  console.log(`    Package manager:  ${detection.packageManager}`);
  console.log(`    Project type:     ${PROJECT_TYPE_LABELS[detection.projectType]}`);
  console.log(`    TypeScript:       ${detection.isTypeScript ? "yes" : "no"}`);
  console.log(`    Pre-commit hooks: ${config.addHusky ? "yes" : "no"}`);
  console.log(`    Docker:           ${config.addDocker ? "yes" : "no"}`);
  console.log(`    CI checks:        ${config.ciChecks.length}/${Object.keys(CI_CHECKS).length}`);
  console.log("");

  console.log(c("bold", "  Files that would be created:"));
  console.log(c("green", "    + .github/workflows/ci.yml"));
  console.log(c("green", "    + .github/workflows/codeql.yml"));
  console.log(c("green", "    + .github/workflows/dependency-review.yml"));
  for (const wf of DEPLOYMENT_TARGETS[config.deployTarget].workflows) {
    console.log(c("green", `    + .github/workflows/${wf}`));
  }

  if (config.addDocker) {
    const df = detection.projectType === "nextjs" ? "Dockerfile (Next.js)" : "Dockerfile";
    console.log(c("green", `    + ${df}`));
    console.log(c("green", "    + docker-compose.yml"));
    console.log(c("green", "    + .dockerignore"));
  }
  if (config.deployTarget === "flyio") console.log(c("green", "    + fly.toml"));
  if (config.deployTarget === "render") console.log(c("green", "    + render.yaml"));
  if (config.addHusky) console.log(c("green", "    + .husky/pre-commit"));
  if (config.copyEslint) console.log(c("green", "    + .eslintrc.json"));
  if (config.copyPrettier) {
    console.log(c("green", "    + .prettierrc"));
    console.log(c("green", "    + .prettierignore"));
  }
  if (config.copyJscpd) console.log(c("green", "    + .jscpd.json"));
  if (config.copyPRTemplate) console.log(c("green", "    + .github/PULL_REQUEST_TEMPLATE.md"));
  if (config.copyPipelineMd) console.log(c("green", "    + PIPELINE.md"));

  if (config.updatePkg) {
    console.log("");
    console.log(c("bold", "  package.json changes:"));
    console.log(c("green", "    + scripts: lint, lint:fix, format, format:check, validate, audit:security, check:duplicates"));
    if (config.addHusky) console.log(c("green", "    + scripts: prepare"));
    console.log(c("green", "    + devDependencies: eslint, prettier"));
    if (detection.isTypeScript) console.log(c("green", "    + devDependencies: @typescript-eslint/parser, @typescript-eslint/eslint-plugin"));
    if (config.addHusky) console.log(c("green", "    + devDependencies: husky, lint-staged"));
    if (config.addHusky) console.log(c("green", "    + lint-staged config"));
  }

  console.log("");
  console.log(c("dim", "  Remove --dry-run to apply changes."));
  console.log("");
}

// =============================================================================
// 9. NEXT STEPS PRINTER
// =============================================================================

function printNextSteps(config, detection) {
  const pm = PKG_MANAGERS[detection.packageManager];
  const target = DEPLOYMENT_TARGETS[config.deployTarget];

  console.log("");
  console.log(c("bold", "  Next steps:"));
  console.log("");

  let step = 1;

  console.log(`  ${step}. Install dependencies:`);
  const installCmd = detection.packageManager === "npm" ? "npm install" : `${detection.packageManager} install`;
  console.log(c("cyan", `     ${installCmd}`));
  step++;

  if (config.addHusky) {
    console.log("");
    console.log(`  ${step}. Initialize Husky:`);
    console.log(c("cyan", `     ${pm.run} prepare`));
    step++;
  }

  console.log("");
  console.log(`  ${step}. Create a dev branch (if you don't have one):`);
  console.log(c("cyan", "     git checkout -b dev && git push -u origin dev"));
  step++;

  if (target.secrets.length > 0 && config.deployTarget !== "none") {
    console.log("");
    console.log(`  ${step}. Configure GitHub Secrets for ${target.label}:`);
    console.log(c("dim", "     Repo Settings > Secrets and variables > Actions"));
    for (const secret of target.secrets) {
      console.log(c("dim", `     - ${secret}`));
    }
    if (config.copyPipelineMd) console.log(c("dim", "     See PIPELINE.md for details"));
    step++;
  }

  if (config.deployTarget === "vercel") {
    console.log("");
    console.log(`  ${step}. Link Vercel project:`);
    console.log(c("cyan", "     npx vercel link"));
    console.log(c("dim", "     Copy VERCEL_ORG_ID and VERCEL_PROJECT_ID from .vercel/project.json"));
    step++;
  }

  if (config.deployTarget === "flyio") {
    console.log("");
    console.log(`  ${step}. Initialize Fly.io app:`);
    console.log(c("cyan", "     fly launch"));
    step++;
  }

  if (config.deployTarget === "railway") {
    console.log("");
    console.log(`  ${step}. Create Railway project:`);
    console.log(c("cyan", "     npx @railway/cli login && npx @railway/cli init"));
    step++;
  }

  console.log("");
  console.log(`  ${step}. Test locally:`);
  console.log(c("cyan", `     ${pm.run} validate`));

  console.log("");
  console.log(c("dim", "  All tools are 100% free. No paid tokens or subscriptions required."));
  console.log("");
}

// =============================================================================
// 10. MAIN ORCHESTRATOR
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`setup-pipeline v${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  ${c("bold", "Usage:")} npx setup-pipeline [directory] [options]

  ${c("bold", "Arguments:")}
    directory              Target project directory (default: current directory)

  ${c("bold", "Options:")}
    --yes, -y              Accept all defaults (non-interactive)
    --dry-run              Show what would be added without writing files
    --node <version>       Node.js version: 16, 18, 20, 22 (default: 20)
    --deploy <target>      Deployment: ssh, docker, vercel, railway, render, flyio, none
    --docker               Add Docker support (Dockerfile + docker-compose)
    --husky                Add pre-commit hooks (Husky + lint-staged)
    --no-docker            Skip Docker support
    --no-husky             Skip pre-commit hooks
    --typescript, --ts     Force TypeScript mode
    --help, -h             Show this help
    --version, -v          Show version

  ${c("bold", "Examples:")}
    npx setup-pipeline                             Interactive setup
    npx setup-pipeline --yes                       All defaults (SSH/PM2)
    npx setup-pipeline --yes --deploy docker       Docker + GHCR deployment
    npx setup-pipeline --yes --deploy vercel       Vercel deployment
    npx setup-pipeline --yes --husky --docker      SSH + Husky + Docker
    npx setup-pipeline --dry-run                   Preview without writing
    npx setup-pipeline /path/to/project --yes      Target specific directory

  ${c("bold", "Deployment targets:")}
    ssh       SSH/PM2 (VPS, EC2, DigitalOcean)
    docker    Docker (GitHub Container Registry)
    vercel    Vercel (Next.js / frontend)
    railway   Railway
    render    Render (free tier available)
    flyio     Fly.io (global edge deployment)
    none      CI checks only (no deployment)
    `);
    process.exit(0);
  }

  printBanner();

  // Parse target directory (skip values that belong to flags)
  const flagsWithValues = new Set(["--deploy", "-d", "--node"]);
  const nonFlagArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      if (flagsWithValues.has(args[i])) i++; // skip next arg (it's the value)
      continue;
    }
    // Check if previous arg was a flag expecting a value
    if (i > 0 && flagsWithValues.has(args[i - 1])) continue;
    nonFlagArgs.push(args[i]);
  }

  const projectDir = path.resolve(nonFlagArgs[0] || ".");
  const autoYes = args.includes("--yes") || args.includes("-y");
  const dryRun = args.includes("--dry-run");
  const forceTS = args.includes("--typescript") || args.includes("--ts");

  if (!fileExists(projectDir)) {
    console.log(c("red", `  Error: Directory "${projectDir}" does not exist.`));
    process.exit(1);
  }

  // Detect project
  const detection = detectProject(projectDir);
  if (forceTS) detection.isTypeScript = true;

  // Display detection summary
  console.log(c("bold", "  Project:         ") + projectDir);
  console.log(c("bold", "  Detected:        ") + c("cyan", PROJECT_TYPE_LABELS[detection.projectType]));
  console.log(c("bold", "  TypeScript:      ") + (detection.isTypeScript ? c("green", "yes") : c("dim", "no")));
  console.log(c("bold", "  Package manager: ") + c("cyan", detection.packageManager));
  console.log(c("bold", "  Existing CI:     ") + (detection.hasExistingGH ? c("yellow", "found") : c("dim", "none")));
  console.log(c("bold", "  ESLint:          ") + (detection.hasExistingEslint ? c("yellow", "found") : c("dim", "none")));
  console.log(c("bold", "  Prettier:        ") + (detection.hasExistingPrettier ? c("yellow", "found") : c("dim", "none")));
  console.log(c("bold", "  Docker:          ") + (detection.hasExistingDocker ? c("yellow", "found") : c("dim", "none")));
  console.log(c("bold", "  Husky:           ") + (detection.hasExistingHusky ? c("yellow", "found") : c("dim", "none")));
  console.log("");

  if (!detection.hasPkg) {
    console.log(c("yellow", "  Warning: No package.json found. Scripts and deps won't be added."));
    console.log("");
  }

  // Get configuration
  let config;
  if (autoYes) {
    config = buildDefaultConfig(detection, args);
    console.log(c("dim", "  Using defaults (--yes mode)"));
    console.log(c("dim", `  Deploy: ${DEPLOYMENT_TARGETS[config.deployTarget].label}`));
    console.log(c("dim", `  Node: ${config.nodeVersion} | Husky: ${config.addHusky ? "yes" : "no"} | Docker: ${config.addDocker ? "yes" : "no"}`));
    console.log("");
  } else {
    const rl = createRL();
    try {
      config = await runInteractivePrompts(rl, detection);
    } finally {
      rl.close();
    }
  }

  // Dry run mode
  if (dryRun) {
    reportDryRun(config, detection);
    process.exit(0);
  }

  // Build replacements
  const replacements = buildReplacements(config, detection);
  const actions = [];

  console.log("");
  console.log(c("bold", "  Setting up pipeline..."));
  console.log("");

  // Execute
  copyWorkflows(projectDir, config, detection, replacements, actions);
  generateDockerFiles(projectDir, config, detection, replacements, actions);
  generateDeploymentConfigs(projectDir, config, detection, replacements, actions);
  setupHusky(projectDir, config, actions);
  copyConfigFiles(projectDir, config, detection, replacements, actions);

  if (config.updatePkg) {
    console.log("");
    updatePackageJson(projectDir, config, detection);
  }

  // Summary
  console.log("");
  console.log(c("bold", c("green", `  Done! ${actions.length} files added/updated.`)));
  printNextSteps(config, detection);
}

main().catch((err) => {
  console.error(c("red", `\n  Error: ${err.message}`));
  process.exit(1);
});
