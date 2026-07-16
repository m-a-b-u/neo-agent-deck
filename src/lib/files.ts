import fs from "node:fs";
import path from "node:path";

export interface FileStamp {
  path: string;
  mtimeMs: number;
  size: number;
}

export async function listJsonl(root: string): Promise<FileStamp[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }

  const output: FileStamp[] = [];
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
    const fullPath = path.join(entry.parentPath, entry.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      output.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      // A session can disappear between readdir and stat.
    }
  }));
  return output;
}

export async function readTail(file: string, bytes: number): Promise<string> {
  try {
    const handle = await fs.promises.open(file, "r");
    try {
      const stat = await handle.stat();
      const size = Math.min(stat.size, bytes);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, stat.size - size);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

export function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function processAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function extractUuid(file: string): string | null {
  return file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1] ?? null;
}
