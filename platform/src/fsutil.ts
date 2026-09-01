// Filesystem primitives shared by every module that touches the ledger.
// All writes are atomic (temp file + rename, DESIGN.md §6) and all paths
// go through path.join/path.* so behavior is correct on Windows as well
// as POSIX (DESIGN.md §8: "Node CLI must run on Windows").
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Atomically write `content` to `filePath`: write to a sibling temp file in
 * the same directory, then rename over the target. Rename within the same
 * volume is atomic on both POSIX and NTFS.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`
  );
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function readFileIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, "utf8");
}

export function readYaml<T = unknown>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return parseYaml(raw) as T;
}

export function readYamlIfExists<T = unknown>(filePath: string): T | undefined {
  const raw = readFileIfExists(filePath);
  if (raw === undefined) return undefined;
  return parseYaml(raw) as T;
}

export function writeYamlAtomic(filePath: string, data: unknown): void {
  writeFileAtomic(filePath, stringifyYaml(data, { lineWidth: 0 }));
}

export function readJson<T = unknown>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export function readJsonIfExists<T = unknown>(filePath: string): T | undefined {
  const raw = readFileIfExists(filePath);
  if (raw === undefined) return undefined;
  return JSON.parse(raw) as T;
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  writeFileAtomic(filePath, JSON.stringify(data, null, 2) + "\n");
}

/** Append one line to a JSONL file, atomically rewriting the whole file. */
export function appendJsonlAtomic(filePath: string, record: unknown): void {
  const existing = readFileIfExists(filePath) ?? "";
  const line = JSON.stringify(record);
  const next = existing.length > 0 && !existing.endsWith("\n") ? `${existing}\n${line}\n` : `${existing}${line}\n`;
  writeFileAtomic(filePath, next);
}

export function readJsonl<T = unknown>(filePath: string): T[] {
  const raw = readFileIfExists(filePath);
  if (raw === undefined) return [];
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T);
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function listFiles(dir: string, ext?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && (!ext || e.name.endsWith(ext)))
    .map((e) => e.name)
    .sort();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Copy a directory tree, never overwriting a file that already exists at
 * the destination. Returns the list of relative paths that were skipped
 * because they already existed (`agent init` in DESIGN.md §6's CLI surface
 * reports skipped files instead of overwriting).
 */
export function copyDirNoOverwrite(src: string, dest: string, relBase = ""): string[] {
  const skipped: string[] = [];
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      skipped.push(...copyDirNoOverwrite(srcPath, destPath, relPath));
    } else if (entry.isFile()) {
      if (fs.existsSync(destPath)) {
        skipped.push(relPath);
      } else {
        ensureDir(path.dirname(destPath));
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  return skipped;
}
