#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".wxml",
  ".wxss",
  ".yaml",
  ".yml",
]);

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".idea",
  ".vscode",
  "coverage",
  "dist",
  "node_modules",
]);

const SECRET_RULES = [
  {
    id: "private-key",
    severity: "P0",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    message: "Private key material must never be committed.",
  },
  {
    id: "aws-access-key",
    severity: "P0",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    message: "Possible AWS access key committed in source.",
  },
  {
    id: "credential-in-url",
    severity: "P0",
    pattern: /\b(?:https?|postgres(?:ql)?|redis):\/\/[^\s/:]+:[^\s/@]+@/i,
    message: "URL contains an embedded credential.",
  },
  {
    id: "assigned-secret",
    severity: "P0",
    pattern:
      /\b(?:app_?secret|client_?secret|api_?secret|private_?key|access_?token|refresh_?token|session_?key|password)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i,
    message: "Possible hard-coded secret; inject it at runtime instead.",
  },
  {
    id: "wechat-app-secret",
    severity: "P0",
    pattern: /\b(?:wx|wechat)[_-]?(?:app)?secret\b\s*[:=]/i,
    message: "WeChat AppSecret must only exist in server-side secret storage.",
  },
];

const PRIVACY_LOG_RULE = {
  id: "sensitive-log",
  severity: "P1",
  pattern:
    /(?:console\.(?:log|info|warn|error|debug)|\blogger\.(?:log|info|warn|error|debug))\s*\([^\n]*(?:phone|mobile|open_?id|session_?key|wechat_?code|emergency_?contact|precise_?location)/i,
  message: "Logging call appears to include sensitive personal or session data.",
};

const CLIENT_SECRET_RULE = {
  id: "client-secret-reference",
  severity: "P0",
  pattern:
    /\b(?:app_?secret|client_?secret|private_?key|session_?key|service_?account|server_?key)\b/i,
  message: "Client code references a server-side secret concept.",
};

function isExcluded(path) {
  return path.split(/[\\/]/).some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function isScannable(path) {
  const extension = extname(path).toLowerCase();
  return SOURCE_EXTENSIONS.has(extension) || path.endsWith(".env.example");
}

function collectFiles(root, current = root, result = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const relativePath = relative(root, path);

    if (isExcluded(relativePath)) continue;
    if (entry.isDirectory()) collectFiles(root, path, result);
    else if (entry.isFile() && isScannable(path)) result.push(path);
  }

  return result;
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function matchesForRule(content, rule) {
  const flags = rule.pattern.flags.includes("g")
    ? rule.pattern.flags
    : `${rule.pattern.flags}g`;
  const pattern = new RegExp(rule.pattern.source, flags);
  const matches = [];
  let match;

  while ((match = pattern.exec(content)) !== null) {
    matches.push({ index: match.index, value: match[0] });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  return matches;
}

export function scanText(content, options = {}) {
  const {
    allowLocalExampleCredentials = false,
    allowTestFixtures = false,
    isClient = false,
  } = options;
  const findings = [];
  const rules = [...SECRET_RULES, PRIVACY_LOG_RULE];
  if (isClient) rules.push(CLIENT_SECRET_RULE);

  for (const rule of rules) {
    for (const match of matchesForRule(content, rule)) {
      const line = lineNumberAt(content, match.index);
      const sourceLine = content.split(/\r?\n/)[line - 1] ?? "";
      if (sourceLine.includes("security-scan: allow")) continue;
      if (
        rule.id === "credential-in-url" &&
        allowLocalExampleCredentials &&
        /@(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(sourceLine)
      ) {
        continue;
      }
      if (
        rule.id === "assigned-secret" &&
        allowTestFixtures &&
        /["'](?:test|fake|dummy|issued|example|mock|replace)[-_][^"']+["']/i.test(match.value)
      ) {
        continue;
      }
      findings.push({
        id: rule.id,
        severity: rule.severity,
        line,
        message: rule.message,
      });
    }
  }

  return findings;
}

export function scanWorkspace(root) {
  const absoluteRoot = resolve(root);
  if (!statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Scan root is not a directory: ${absoluteRoot}`);
  }

  const findings = [];
  for (const file of collectFiles(absoluteRoot)) {
    const relativePath = relative(absoluteRoot, file).split(sep).join("/");
    const isClient = relativePath.startsWith("apps/mini-program/");
    const content = readFileSync(file, "utf8");
    for (const finding of scanText(content, {
      allowLocalExampleCredentials: relativePath.endsWith(".env.example"),
      allowTestFixtures: /(?:^|\/)(?:test|tests)\//.test(relativePath),
      isClient,
    })) {
      findings.push({ ...finding, file: relativePath });
    }
  }
  return findings;
}

function runCli() {
  const root = resolve(process.argv[2] ?? process.cwd());
  const findings = scanWorkspace(root);
  if (findings.length === 0) {
    console.log("Security/privacy scan passed: no blocking patterns found.");
    return;
  }

  for (const finding of findings) {
    console.error(
      `[${finding.severity}] ${finding.id} ${finding.file}:${finding.line} - ${finding.message}`,
    );
  }
  console.error(`Security/privacy scan failed with ${findings.length} finding(s).`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) runCli();
