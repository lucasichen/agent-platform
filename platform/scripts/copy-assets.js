// Copies the read-only monorepo inputs this package needs at runtime into
// dist/assets/ so the published/installed CLI works in a target repo
// without the agent-platform monorepo present (DESIGN.md §3, §6).
//
//   ../schemas          -> dist/assets/schemas          (source of truth for validate.ts)
//   ../policies          -> dist/assets/policies          (copied into target repos by `agent init`)
//   ../templates/repo    -> dist/assets/templates/repo    (the .agent/ scaffold `agent init` installs)
//   ../registry/workflows -> dist/assets/registry/workflows (F.0 compiler fallback registry)
//
// The registry/workflows copy is best-effort: it is authored in parallel by
// another work package and may not exist at build time. Its absence must
// not fail the build (compiler.ts and the test suite never depend on it).
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const platformDist = path.join(__dirname, "..", "dist");

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyRequired(relSrc, relDest) {
  const src = path.join(root, relSrc);
  const dest = path.join(platformDist, "assets", relDest);
  if (!fs.existsSync(src)) {
    throw new Error(`copy-assets: required source missing: ${src}`);
  }
  copyDirRecursive(src, dest);
  console.log(`copy-assets: ${relSrc} -> dist/assets/${relDest}`);
}

function copyOptional(relSrc, relDest) {
  const src = path.join(root, relSrc);
  if (!fs.existsSync(src)) {
    console.log(`copy-assets: optional source absent, skipping: ${relSrc}`);
    return;
  }
  const dest = path.join(platformDist, "assets", relDest);
  copyDirRecursive(src, dest);
  console.log(`copy-assets: ${relSrc} -> dist/assets/${relDest}`);
}

copyRequired("schemas", "schemas");
copyRequired("policies", "policies");
copyRequired(path.join("templates", "repo"), path.join("templates", "repo"));
copyOptional(path.join("registry", "workflows"), path.join("registry", "workflows"));
