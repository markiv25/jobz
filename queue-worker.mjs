/**
 * queue-worker.mjs — Parallel JD processor (up to 5 concurrent claude -p instances)
 * Spawned automatically by resume-server.mjs every 30s when queue has pending items.
 */

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE  = path.join(__dirname, 'data', 'jd-queue.json');
const MAP_FILE    = path.join(__dirname, 'data', 'resume-map.json');
const LOG_FILE    = path.join(__dirname, 'data', 'worker.log');
const CV_FILE     = path.join(__dirname, 'cv.md');
const TEMPLATE_FILE = path.join(__dirname, 'templates', 'VikramParmar_Resume_v21.tex');
const OUTPUT_BASE = path.join(__dirname, 'output');
const LOCK_FILE   = path.join(__dirname, 'data', '.worker.lock');

const MAX_PARALLEL = 5;
const MODEL        = 'claude-sonnet-4-6';

function toDirName(company, role) {
  const clean = s => (s || '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
  return (clean(company) + '-' + clean(role)).slice(0, 64) || 'unknown';
}

// ── helpers ──────────────────────────────────────────────────────────────────

function loadJSON(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
function saveJSON(f, data) {
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
}

function log(msg) {
  const ts   = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function setStep(itemId, step) {
  try {
    const q = loadJSON(QUEUE_FILE) || [];
    const i = q.findIndex(x => x.id === itemId);
    if (i !== -1) { q[i].step = step; saveJSON(QUEUE_FILE, q); }
  } catch {}
  log(`  [${itemId.slice(0, 6)}] ${step}`);
}

function acquireLock() {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
      try { process.kill(pid, 0); return false; }
      catch { fs.unlinkSync(LOCK_FILE); return acquireLock(); }
    } catch { return false; }
  }
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch {} }

function getResumeN() {
  const r = spawnSync('node', [path.join(__dirname, 'get-resume-n.mjs')], { encoding: 'utf8' });
  const n = parseInt((r.stdout || '').trim());
  if (isNaN(n)) throw new Error('get-resume-n returned: ' + r.stdout);
  return n;
}

function compilePDF(texPath, pdfPath) {
  const r = spawnSync('node', [path.join(__dirname, 'generate-pdf-latex.mjs'), texPath, pdfPath], {
    encoding: 'utf8', timeout: 120000
  });
  if (r.status !== 0) throw new Error(r.stderr || 'compile failed');
}

// Count pages in a compiled PDF. Tries pdfinfo, then macOS mdls, then a
// raw /Count scan of the file bytes. Returns 0 if undeterminable.
function pdfPageCount(pdfPath) {
  // pdfinfo (poppler) — most reliable when present
  let r = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (r.status === 0) {
    const m = r.stdout.match(/Pages:\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  // macOS Spotlight metadata
  r = spawnSync('mdls', ['-name', 'kMDItemNumberOfPages', '-raw', pdfPath], { encoding: 'utf8' });
  if (r.status === 0) {
    const n = parseInt((r.stdout || '').trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // last resort: count /Type /Page objects in the raw bytes
  try {
    const buf = fs.readFileSync(pdfPath, 'latin1');
    const m = buf.match(/\/Type\s*\/Page[^s]/g);
    if (m) return m.length;
  } catch {}
  return 0;
}

// Ask the model to shrink an overflowing .tex back to ONE page. Returns the
// trimmed .tex, or null if it can't be extracted.
async function shrinkTex(texContent, attempt) {
  const prompt = `The following LaTeX resume compiled to MORE THAN ONE PAGE. It MUST fit on exactly ONE letter-size page.

Trim it so it fits on one page, following these rules STRICTLY:
- Do NOT drop any section, any job, or any bullet. Every bullet stays.
- Do NOT change the preamble (\\documentclass, geometry, packages) — keep it byte-for-byte.
- Shorten by tightening WORDING inside existing bullets (remove redundant clauses, trailing filler) and, if needed, nudging the existing \\vspace values slightly more negative. Keep the candidate's exact metrics and meaning.
- Do NOT add buzzwords or rephrase into corporate speak.
- This is trim attempt ${attempt}; be more aggressive than before if needed, but never delete content.

Output ONLY the corrected full .tex between markers, nothing else:
===TEX_START===
[corrected one-page .tex]
===TEX_END===

CURRENT .TEX:
${texContent}`;
  const out = await runClaude(prompt);
  const s = out.indexOf('===TEX_START===');
  const e = out.indexOf('===TEX_END===');
  if (s === -1 || e === -1) return null;
  const tex = out.slice(s + 15, e).trim();
  return tex.includes('\\documentclass') ? tex : null;
}

// ── async claude runner ───────────────────────────────────────────────────────

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--output-format', 'text', '--model', MODEL], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.stdin.write(prompt);
    proc.stdin.end();
    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout after 180s')); }, 180000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && stdout) resolve(stdout);
      else reject(new Error((stderr || 'no output').slice(0, 300)));
    });
  });
}

// ── prompt builder ────────────────────────────────────────────────────────────

// Cheap score-only prompt — compares the JD against the default CV. No template,
// no .tex output. Just the JSON verdict. ~10x cheaper than the generate prompt.
function buildScorePrompt(jd, cv) {
  return `You are screening a job for Vikram Kumar Parmar, a Data Engineer.

Score how well his EXISTING resume (below) fits this job, 1.0–5.0, on: skill match,
seniority, domain, location, and experience gap. Be honest and strict — a generic
data-engineering profile scoring against an ML-research or pure-SWE role is a poor fit.

Also flag HARD blocks: the JD requires no visa sponsorship ("must be authorized to
work in the US without sponsorship", "US citizen or LPR", "US Person required") or an
active security clearance. Vikram REQUIRES sponsorship (F-1 STEM OPT) — mark these.

## Resume
${cv}

## Job Description
${jd}

## Output — ONE line of JSON, nothing else (no markdown):
{"score":"X.X/5","company":"...","role":"...","location":"...","hard_block":false,"reason":"one short sentence"}
`;
}

function buildPrompt(jd, cv, force = false, effort = 'med') {
  let baseTex = '';
  try { baseTex = fs.readFileSync(TEMPLATE_FILE, 'utf8'); } catch {}

  const effortInstruction = effort === 'hard'
    ? 'Inject JD keywords everywhere they legitimately fit — Skills line(s), summary, and existing bullets — and you MAY reorder the Anuvu bullets so the most JD-relevant ones come first. Add every JD tech term that maps to REAL candidate experience. NEVER invent skills. NEVER rephrase — insert the exact JD term into existing phrasing.'
    : 'Add missing JD keywords to the Skills section ONLY. Keep the summary and every bullet word-for-word unchanged. Add only terms from the JD that map to real experience already in the resume.';

  return `You are a resume tailoring agent for Vikram Kumar Parmar.

## What you are doing
You are given Vikram's FINISHED, polished 1-page LaTeX resume (the BASE TEMPLATE
below). It is already correct, honest, and fits on exactly one page. Your job is
to make MINIMAL, surgical edits to tailor it to the job description — NOT to
rebuild it. Start from the base template verbatim and change as little as possible.

## HARD WRITING RULES (apply at ALL effort levels)
- Do NOT rephrase or paraphrase existing bullet points. Keep the candidate's exact wording.
- Do NOT add buzzwords or corporate speak. BANNED: spearheaded, leveraged, architected,
  engineered, drove adoption, utilized, facilitated, implemented, robust, seamless,
  passionate about, results-oriented, proven track record.
- Adding a keyword = inserting the EXACT JD term naturally into an existing phrase or
  into the Skills list. Never invent skills not supported by the resume/CV.
- 1 PAGE HARD LIMIT. The base already fits. If your edits would overflow, trim wording —
  NEVER drop a bullet or section, and NEVER change the preamble spacing/geometry.
- Keep ALL header values, education, projects, publications, and the LaTeX preamble EXACTLY as in the base.
- Only these may change: the headline role title (center block), the Professional
  Summary wording (lightly), the Skills lines, and (hard effort only) Anuvu bullet ORDER.

## Candidate CV (source of truth — never invent skills not present here)
${cv}

## Instructions
1. Score the JD fit 1.0–5.0 (skill match, seniority, location/remote, domain, comp, experience gap).
2. HARD SKIP if the JD requires no sponsorship or a clearance: "no visa sponsorship",
   "not eligible for visa sponsorship", "must be authorized to work in the US without
   sponsorship", "US citizen or LPR", "US Person required", or any active security clearance.
   Vikram REQUIRES sponsorship (F-1 STEM OPT) — these are disqualifying.
3. ${force
  ? 'FORCE GENERATE — the user explicitly requested a tailored resume for THIS job regardless of score, fit, location, or visa/clearance language. You MUST set verdict to "generate" and you MUST output the full .tex between the TEX markers. Still report the honest score and, in skip_reason, briefly note any concern (fit gap, visa, etc.) so the user sees WHY — but DO generate the resume.'
  : 'AUTO-SKIP if score < 3.0 — do NOT generate a resume for anything below 3.0. Output verdict "skip" with a clear skip_reason.'}
4. Effort level: ${effort.toUpperCase()} — ${effortInstruction}
5. Update the headline role title (the line "Data Engineer \\textbar{} Austin, TX ...")
   to match the JD's role title when it's a data/ML role; otherwise keep "Data Engineer".
6. LaTeX special chars in ANY text you touch: % → \\%, & → \\&, _ → \\_, # → \\#, $ → \\$, ~ → \\textasciitilde{}

## BASE TEMPLATE (start from this verbatim; edit surgically)
===BASE_START===
${baseTex}
===BASE_END===

## Job Description
${jd}

## Output format — machine-parsed, follow EXACTLY

First line — JSON (no markdown fences):
{"score":"X.X/5","verdict":"generate","company":"...","role":"...","location":"..."}
OR:
{"score":"X.X/5","verdict":"skip","company":"...","role":"...","location":"...","skip_reason":"..."}

If verdict=generate, output the complete tailored .tex (full document, \\documentclass … \\end{document}) between markers:
===TEX_START===
[complete .tex — base template with your surgical edits applied]
===TEX_END===
`;
}

// ── process a single item ─────────────────────────────────────────────────────

async function processItem(item, cv) {
  const label = item.company || item.id.slice(0, 8);
  log(`┌── Starting: ${label}`);

  const THRESHOLD = 2.8;   // generate only when score > 2.8

  // ── PHASE 1: cheap score (no template, no .tex) ──────────────────────────────
  setStep(item.id, '[1/4] Scoring against your resume (~15s)');
  let scoreOut;
  try {
    scoreOut = await runClaude(buildScorePrompt(item.jd, cv));
  } catch (err) {
    setStep(item.id, 'ERROR: ' + err.message.slice(0, 120));
    return { id: item.id, status: 'error', error: err.message.slice(0, 120) };
  }

  let sc;
  const scLine = scoreOut.trim().split('\n').find(l => l.trim().startsWith('{'));
  try { sc = JSON.parse(scLine || ''); } catch {
    const m = scoreOut.match(/\{[^{}]*"score"[^{}]*\}/);
    if (m) try { sc = JSON.parse(m[0]); } catch {}
  }
  if (!sc) { setStep(item.id, 'ERROR: score parse failed'); return { id: item.id, status: 'error', error: 'score parse failed' }; }

  const scoreNum = parseFloat(sc.score) || 0;
  const isHardBlock = sc.hard_block === true || /visa|citizen|clearance|sponsor/i.test(sc.reason || '');
  log(`  [${item.id.slice(0, 6)}] Score: ${sc.score} | ${sc.company} | ${isHardBlock ? 'HARD-BLOCK' : 'ok'}`);

  // ── GATE: below threshold → skip (unless force) ──────────────────────────────
  const forced = item.force || item.forceAll;
  const blocked = isHardBlock && !item.forceAll;   // forceAll overrides even hard blocks
  let flaggedReason = '';
  if ((scoreNum <= THRESHOLD || blocked) && !forced) {
    const why = blocked ? (sc.reason || 'requires no sponsorship / clearance') : `score ${sc.score} ≤ ${THRESHOLD}`;
    setStep(item.id, `SKIP (${sc.score}) — ${why}`);
    return { id: item.id, status: 'skip', score: sc.score, company: sc.company, role: sc.role, location: sc.location, reason: why };
  }
  if (forced && (scoreNum <= THRESHOLD || isHardBlock)) {
    flaggedReason = sc.reason || (scoreNum <= THRESHOLD ? `score ${sc.score} ≤ ${THRESHOLD}` : 'hard block');
    log(`  [${item.id.slice(0, 6)}] Force-generate override`);
  }

  // ── PHASE 2: generate tailored resume (only reached when > 2.8 or forced) ─────
  const meta = { score: sc.score, company: sc.company, role: sc.role, location: sc.location, verdict: 'generate' };
  setStep(item.id, '[2/4] Generating tailored resume (~45s)');
  let output;
  try {
    output = await runClaude(buildPrompt(item.jd, cv, true, item.effort || 'med'));
  } catch (err) {
    setStep(item.id, 'ERROR: ' + err.message.slice(0, 120));
    return { id: item.id, status: 'error', error: err.message.slice(0, 120) };
  }

  // Extract .tex
  const s = output.indexOf('===TEX_START===');
  const e = output.indexOf('===TEX_END===');
  if (s === -1 || e === -1 || !output.slice(s + 15, e).includes('\\documentclass')) {
    setStep(item.id, 'ERROR: TEX markers missing');
    return { id: item.id, status: 'error', error: 'TEX extraction failed' };
  }
  const texContent = output.slice(s + 15, e).trim();

  setStep(item.id, '[3/4] Writing .tex');
  const dateStr = new Date().toISOString().slice(0, 10);
  const dirName = toDirName(meta.company, meta.role);
  const texPath = `/tmp/vikram_parmar_resume_${dirName}.tex`;
  fs.writeFileSync(texPath, texContent, 'utf8');

  setStep(item.id, '[4/4] Compiling PDF');
  const outDir  = path.join(OUTPUT_BASE, dateStr, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, 'vikram_parmar_resume.pdf');
  const mapKey  = `${dateStr}/${dirName}/vikram_parmar_resume`;

  // Compile, then enforce the 1-page hard limit: if it overflows, ask the
  // model to trim and recompile (up to 3 attempts).
  let tex = texContent;
  const MAX_FIT_TRIES = 3;
  try {
    compilePDF(texPath, pdfPath);
    for (let attempt = 1; attempt <= MAX_FIT_TRIES; attempt++) {
      const pages = pdfPageCount(pdfPath);
      if (pages <= 1 || pages === 0) break;   // 0 = undeterminable, don't loop forever
      setStep(item.id, `[4/4] ${pages}pg — trimming to 1 page (try ${attempt})`);
      log(`  [${item.id.slice(0, 6)}] ${pages} pages — shrink attempt ${attempt}`);
      const shrunk = await shrinkTex(tex, attempt);
      if (!shrunk) { log(`  [${item.id.slice(0, 6)}] shrink failed to parse — keeping current`); break; }
      tex = shrunk;
      fs.writeFileSync(texPath, tex, 'utf8');
      compilePDF(texPath, pdfPath);
    }
  } catch (err) {
    setStep(item.id, 'ERROR: compile — ' + err.message.slice(0, 100));
    return { id: item.id, status: 'error', error: err.message.slice(0, 100) };
  }
  const finalPages = pdfPageCount(pdfPath);
  if (finalPages > 1) log(`  [${item.id.slice(0, 6)}] ⚠ still ${finalPages} pages after ${MAX_FIT_TRIES} tries`);

  const kb = Math.round(fs.statSync(pdfPath).size / 1024);
  setStep(item.id, `[4/4] Updating tracker (${kb} KB)`);
  log(`└── ✓ Done: ${meta.company} — ${meta.role} (${meta.score})`);

  return {
    id: item.id, status: 'done', mapKey,
    score: meta.score, company: meta.company, role: meta.role, location: meta.location,
    flaggedReason
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  try { if (fs.statSync(LOG_FILE).size > 100000) fs.writeFileSync(LOG_FILE, ''); } catch {}

  if (!acquireLock()) { log('Another worker already running — exiting'); process.exit(0); }

  try {
    const cv      = fs.readFileSync(CV_FILE, 'utf8');
    const queue   = loadJSON(QUEUE_FILE) || [];
    const pending = queue.filter(q => q.status === 'pending');

    if (pending.length === 0) { log('No pending items'); return; }

    const batch = pending.slice(0, MAX_PARALLEL);
    log(`━━━ Processing ${batch.length} item(s) in parallel (model: ${MODEL}) ━━━`);

    // Mark all as processing upfront
    const q0 = loadJSON(QUEUE_FILE) || [];
    for (const item of batch) {
      const i = q0.findIndex(x => x.id === item.id);
      if (i !== -1) { q0[i].status = 'processing'; q0[i].step = 'Queued for parallel run…'; }
    }
    saveJSON(QUEUE_FILE, q0);

    // Run all in parallel
    const results = await Promise.all(batch.map(item => processItem(item, cv)));

    // Update queue + map sequentially (avoid concurrent write collision)
    const qFinal  = loadJSON(QUEUE_FILE) || [];
    const mapFinal = loadJSON(MAP_FILE)  || {};

    for (const result of results) {
      const i = qFinal.findIndex(x => x.id === result.id);
      if (i === -1) continue;

      if (result.status === 'done') {
        const jd = qFinal[i].jd || '';
        qFinal.splice(i, 1); // remove — shows in Resumes tab
        mapFinal[result.mapKey] = {
          company: result.company, role: result.role,
          location: result.location, score: result.score, jd,
          flaggedReason: result.flaggedReason || ''
        };
      } else if (result.status === 'skip') {
        qFinal[i].status  = 'skip';
        qFinal[i].company = result.company || qFinal[i].company;
        qFinal[i].role    = result.role    || qFinal[i].role;
        qFinal[i].step    = `${result.score} — ${result.reason || 'below threshold'}`;
      } else {
        qFinal[i].status = 'error';
        qFinal[i].step   = 'Error: ' + result.error;
      }
    }

    saveJSON(QUEUE_FILE, qFinal);
    saveJSON(MAP_FILE,   mapFinal);

    const done    = results.filter(r => r.status === 'done').length;
    const skipped = results.filter(r => r.status === 'skip').length;
    const errors  = results.filter(r => r.status === 'error').length;
    log(`━━━ Batch complete: ${done} generated, ${skipped} skipped, ${errors} errors ━━━`);

    // If more items remain, self-spawn another batch
    const remaining = (loadJSON(QUEUE_FILE) || []).filter(q => q.status === 'pending').length;
    if (remaining > 0) {
      log(`${remaining} item(s) still pending — will be picked up next cycle`);
    }

  } finally {
    releaseLock();
  }
}

main().catch(err => { log('Fatal: ' + err.message); releaseLock(); process.exit(1); });
