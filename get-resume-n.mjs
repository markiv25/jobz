/**
 * get-resume-n.mjs — Atomic resume counter for parallel agent safety.
 *
 * Usage: node get-resume-n.mjs
 * Prints the next available resume number to stdout and increments the counter.
 *
 * Uses an exclusive lock file to prevent race conditions when multiple agents
 * run in parallel. Each agent claims a unique number before writing any files.
 */

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, readdirSync } from 'fs';

const COUNTER_FILE = 'output/.resume-counter';
const LOCK_FILE    = 'output/.resume-counter.lock';
const MAX_RETRIES  = 60;   // 6 seconds total wait
const RETRY_MS     = 100;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function acquireLock() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      // 'wx' = exclusive create — atomic at OS level, fails if file exists
      const fd = openSync(LOCK_FILE, 'wx');
      closeSync(fd);
      return;
    } catch (e) {
      if (e.code === 'EEXIST') {
        await sleep(RETRY_MS);
      } else {
        throw e;
      }
    }
  }
  // Stale lock guard: if lock is older than 10s, remove and retry once
  try {
    const stat = (await import('fs')).statSync(LOCK_FILE);
    if (Date.now() - stat.mtimeMs > 10_000) {
      unlinkSync(LOCK_FILE);
      const fd = openSync(LOCK_FILE, 'wx');
      closeSync(fd);
      return;
    }
  } catch (_) {}
  throw new Error(`[get-resume-n] Could not acquire lock after ${MAX_RETRIES * RETRY_MS}ms`);
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch (_) {}
}

function initFromOutput() {
  // Bootstrap: scan output/ and all date subfolders for the highest existing N
  try {
    const nums = [];
    const entries = readdirSync('output', { withFileTypes: true });
    for (const entry of entries) {
      const files = entry.isDirectory()
        ? readdirSync(`output/${entry.name}`)
        : [entry.name];
      for (const f of files) {
        const m = f.match(/^vikram_parmar_resume_(\d+)\.pdf$/);
        if (m) nums.push(parseInt(m[1]));
      }
    }
    return nums.length ? Math.max(...nums) : 0;
  } catch (_) {
    return 0;
  }
}

async function main() {
  await acquireLock();
  try {
    const current = existsSync(COUNTER_FILE)
      ? parseInt(readFileSync(COUNTER_FILE, 'utf8').trim(), 10)
      : initFromOutput();

    const next = current + 1;
    writeFileSync(COUNTER_FILE, String(next));
    process.stdout.write(String(next));
  } finally {
    releaseLock();
  }
}

main().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
