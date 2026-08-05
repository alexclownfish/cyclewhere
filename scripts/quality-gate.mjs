#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.argv[2] ?? process.cwd());
const nodeCommand = process.execPath;
const bundledNpmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const failures = [];

function run(label, command, args, cwd = root, shell = false) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
    shell,
  });

  if (result.error || result.status !== 0) {
    failures.push(label);
    if (result.error) console.error(result.error.message);
  }
}

function discoverPackages() {
  const appsDirectory = join(root, "apps");
  if (!existsSync(appsDirectory)) return [];

  return readdirSync(appsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(appsDirectory, entry.name))
    .filter((directory) => existsSync(join(directory, "package.json")))
    .sort();
}

function discoverRootTests(directory) {
  const tests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) tests.push(...discoverRootTests(path));
    else if (/\.test\.(?:c|m)?js$/i.test(entry.name)) tests.push(path);
  }
  return tests.sort();
}

run("security and privacy scan", nodeCommand, [join(root, "scripts/security-scan.mjs"), root]);

const rootTests = join(root, "tests");
if (existsSync(rootTests)) {
  const testFiles = discoverRootTests(rootTests);
  if (testFiles.length > 0) {
    run("quality asset tests", nodeCommand, ["--test", ...testFiles]);
  }
}

for (const directory of discoverPackages()) {
  const packagePath = join(directory, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const scripts = packageJson.scripts ?? {};
  const packageName = packageJson.name ?? relative(root, directory);

  for (const script of ["typecheck", "test", "build", "lint"]) {
    if (scripts[script]) {
      if (existsSync(bundledNpmCli)) {
        run(`${packageName}: ${script}`, nodeCommand, [bundledNpmCli, "run", script], directory);
      } else {
        run(
          `${packageName}: ${script}`,
          "npm",
          ["run", script],
          directory,
          process.platform === "win32",
        );
      }
    }
  }

  if (existsSync(join(directory, "package-lock.json"))) {
    const auditArgs = ["audit", "--omit=dev", "--audit-level=high"];
    if (existsSync(bundledNpmCli)) {
      run(`${packageName}: production dependency audit`, nodeCommand, [bundledNpmCli, ...auditArgs], directory);
    } else {
      run(
        `${packageName}: production dependency audit`,
        "npm",
        auditArgs,
        directory,
        process.platform === "win32",
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\nQuality gate failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nQuality gate passed.");
}
