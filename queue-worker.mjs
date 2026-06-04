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

function buildPrompt(jd, cv, force = false) {
  return `You are a resume tailoring agent for Vikram Kumar Parmar.

## Candidate CV (source of truth — NEVER invent skills not present here)
${cv}

## Instructions
1. Score the JD fit 1.0–5.0 based on: skill match, seniority, location/remote, domain, comp, experience gap
2. HARD SKIP if JD contains: "no visa sponsorship" / "not eligible for visa sponsorship" / "U.S. citizen or LPR" / "U.S. Person required" / requires active security clearance
3. ${force ? 'FORCE GENERATE regardless of score — user explicitly requested this. Still hard-skip on visa/clearance blocks.' : 'AUTO-SKIP if score < 2.5'}
4. If generating: tailor summary + reorder bullets by JD relevance + inject keywords naturally. 1 page max.
5. LaTeX special chars (ALL injected text): % → \\%, & → \\&, _ → \\_, # → \\#, $ → \\$, ~ → \\textasciitilde{}

## Fixed header values
- Name: Vikram Kumar Parmar  |  Phone: 585-309-8998  |  Email: parmar.vik25@gmail.com
- GitHub: github.com/markiv25  |  LinkedIn: linkedin.com/in/vikramparmar25
- Headline format: [Role Title] \\textbar{} Austin, TX

## LaTeX template
\\documentclass[10.9pt, letterpaper]{article}
\\usepackage[top=0.32in, bottom=0.32in, left=0.42in, right=0.42in]{geometry}
\\usepackage{enumitem}\\usepackage{titlesec}\\usepackage{hyperref}
\\usepackage[T1]{fontenc}\\usepackage[utf8]{inputenc}\\usepackage{helvet}
\\renewcommand{\\familydefault}{\\sfdefault}\\usepackage{parskip}
\\hyphenpenalty=10000\\exhyphenpenalty=10000
\\hypersetup{colorlinks=true, urlcolor=black, linkcolor=black}
\\titleformat{\\section}{\\normalfont\\small\\bfseries\\uppercase}{}{0em}{}[\\vspace{-4pt}\\rule{\\linewidth}{0.6pt}\\vspace{-1pt}]
\\titlespacing{\\section}{0pt}{6pt}{2pt}
\\setlist[itemize]{leftmargin=1.1em, itemsep=1pt, parsep=0pt, topsep=1pt, label=\\textbullet}
\\pagestyle{empty}\\parskip=0pt\\parindent=0pt
\\begin{document}
\\begin{center}
  {\\large\\bfseries <<NAME>>}\\\\[2pt]
  {\\small <<HEADLINE>>}\\\\[1pt]
  {\\small <<PHONE>> \\textbar{} \\href{mailto:<<EMAIL>>}{<<EMAIL>>} \\textbar{} \\href{https://<<GITHUB_URL>>}{<<GITHUB_DISPLAY>>} \\textbar{} \\href{https://<<LINKEDIN_URL>>}{<<LINKEDIN_DISPLAY>>}}
\\end{center}
\\vspace{2pt}
\\section{Professional Summary}{\\small <<SUMMARY_TEXT>>}
\\vspace{-0.2em}\\section{Skills}{\\small\\n<<SKILLS_BLOCK>>\\n}\\medskip
\\vspace{-0.8em}\\section{Technical Experience}<<EXPERIENCE_BLOCK>>
\\vspace{-0.1em}\\section{Education}{\\small\\n<<EDUCATION_BLOCK>>\\n}
\\vspace{-0.1em}\\section{Projects}{\\small\\n<<PROJECTS_BLOCK>>\\n}
\\vspace{-0.1em}\\section{Publications}{\\small\\n<<PUBLICATIONS_BLOCK>>\\n}
\\end{document}

## Job Description
${jd}

## Output format — machine-parsed, follow EXACTLY

First line — JSON (no markdown fences):
{"score":"X.X/5","verdict":"generate","company":"...","role":"...","location":"..."}
OR:
{"score":"X.X/5","verdict":"skip","company":"...","role":"...","location":"...","skip_reason":"..."}

If verdict=generate, output the complete filled .tex between markers:
===TEX_START===
[complete .tex with all <<PLACEHOLDERS>> replaced]
===TEX_END===
`;
}

// ── process a single item ─────────────────────────────────────────────────────

async function processItem(item, cv) {
  const label = item.company || item.id.slice(0, 8);
  log(`┌── Starting: ${label}`);

  setStep(item.id, '[1/6] claude -p scoring + generating (~60s)');

  let output;
  try {
    output = await runClaude(buildPrompt(item.jd, cv, item.force));
  } catch (err) {
    setStep(item.id, 'ERROR: ' + err.message.slice(0, 120));
    return { id: item.id, status: 'error', error: err.message.slice(0, 120) };
  }

  setStep(item.id, '[2/6] Parsing response');

  const firstLine = output.trim().split('\n').find(l => l.trim().startsWith('{'));
  let meta;
  try { meta = JSON.parse(firstLine || ''); } catch {
    const m = output.slice(0, 800).match(/\{[^{}]+\}/);
    if (m) try { meta = JSON.parse(m[0]); } catch {}
  }

  if (!meta) {
    setStep(item.id, 'ERROR: JSON parse failed');
    return { id: item.id, status: 'error', error: 'JSON parse failed' };
  }

  log(`  [${item.id.slice(0, 6)}] Score: ${meta.score} | ${meta.verdict} | ${meta.company}`);

  if (meta.verdict === 'skip') {
    const isHardBlock = /visa|citizen|clearance/i.test(meta.skip_reason || '');
    if (item.force && !isHardBlock) {
      log(`  [${item.id.slice(0, 6)}] Force-generate override`);
      meta.verdict = 'generate';
    } else {
      setStep(item.id, `SKIP (${meta.score}) — ${meta.skip_reason || 'below threshold'}`);
      return { id: item.id, status: 'skip', score: meta.score, company: meta.company, role: meta.role, location: meta.location, reason: meta.skip_reason };
    }
  }

  // Extract .tex
  const s = output.indexOf('===TEX_START===');
  const e = output.indexOf('===TEX_END===');
  if (s === -1 || e === -1 || !output.slice(s + 15, e).includes('\\documentclass')) {
    setStep(item.id, 'ERROR: TEX markers missing');
    return { id: item.id, status: 'error', error: 'TEX extraction failed' };
  }
  const texContent = output.slice(s + 15, e).trim();

  setStep(item.id, '[3/6] Writing .tex');
  const dateStr = new Date().toISOString().slice(0, 10);
  const dirName = toDirName(meta.company, meta.role);
  const texPath = `/tmp/vikram_parmar_resume_${dirName}.tex`;
  fs.writeFileSync(texPath, texContent, 'utf8');

  setStep(item.id, '[4/6] Compiling PDF');
  const outDir  = path.join(OUTPUT_BASE, dateStr, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, 'vikram_parmar_resume.pdf');
  const mapKey  = `${dateStr}/${dirName}/vikram_parmar_resume`;

  try {
    compilePDF(texPath, pdfPath);
  } catch (err) {
    setStep(item.id, 'ERROR: compile — ' + err.message.slice(0, 100));
    return { id: item.id, status: 'error', error: err.message.slice(0, 100) };
  }

  const kb = Math.round(fs.statSync(pdfPath).size / 1024);
  setStep(item.id, `[5/6] Updating tracker (${kb} KB)`);
  log(`└── ✓ Done: ${meta.company} — ${meta.role} (${meta.score})`);

  return {
    id: item.id, status: 'done', mapKey,
    score: meta.score, company: meta.company, role: meta.role, location: meta.location
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
          location: result.location, score: result.score, jd
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
