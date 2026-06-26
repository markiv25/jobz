/**
 * resume-server.mjs — Local resume tracker dashboard.
 * Usage: node resume-server.mjs
 * Opens: http://localhost:3131
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3131;
const OUTPUT_DIR = path.join(__dirname, 'output');
const MAP_FILE   = path.join(__dirname, 'data', 'resume-map.json');
const QUEUE_FILE = path.join(__dirname, 'data', 'jd-queue.json');

function loadMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); }
  catch { return {}; }
}

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); }
  catch { return []; }
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function scanPDFs() {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.pdf')) continue;
      const rel   = path.relative(OUTPUT_DIR, full);
      const parts = rel.split(path.sep);
      const date  = parts.length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) ? parts[0] : null;
      // new-style key: date/Company-Role/vikram_parmar_resume  (rel without .pdf)
      // old-style key: vikram_parmar_resume_N  (filename without .pdf)
      const relKey  = rel.replace('.pdf', '');
      const fileKey = entry.name.replace('.pdf', '');
      const mtime = fs.statSync(full).mtimeMs;
      results.push({ file: entry.name, relKey, fileKey, rel, date, full, mtime });
    }
  }
  walk(OUTPUT_DIR);
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

function scoreColor(score) {
  if (!score) return '#475569';
  const n = parseFloat(score);
  if (n >= 4.0) return '#22c55e';
  if (n >= 3.0) return '#eab308';
  if (n >= 2.5) return '#f97316';
  return '#ef4444';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function buildQAPage(item, apiUrl) {
  const company     = item.company || '';
  const role        = item.role    || '';
  const hasJD       = !!(item.jd || '').trim();
  const jdEsc       = (item.jd || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const resolvedApiUrl = apiUrl || ('/api/qa/' + item.id);
  const headerTitle = [company, role].filter(Boolean).join(' — ') || 'Application Q&A';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA — ${company}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 0.9rem 1.5rem; border-bottom: 1px solid #1e293b; display: flex; align-items: center; gap: 1rem; flex-shrink: 0; }
  header h1 { font-size: 1rem; font-weight: 600; color: #fff; }
  header .meta { font-size: 0.8rem; color: #64748b; }
  .workspace { display: flex; flex: 1; overflow: hidden; }
  .pane { display: flex; flex-direction: column; overflow: hidden; }
  .pane-jd { width: 38%; border-right: 1px solid #1e293b; }
  .pane-qa  { flex: 1; }
  .pane-header { padding: 0.6rem 1rem; font-size: 0.7rem; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.07em; border-bottom: 1px solid #1e293b; flex-shrink: 0; background: #0a0e17; }
  .jd-body { flex: 1; overflow-y: auto; padding: 1rem; font-size: 0.78rem; color: #94a3b8; white-space: pre-wrap; line-height: 1.7; }
  .qa-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .qa-input { flex-shrink: 0; padding: 1rem; border-bottom: 1px solid #1e293b; display: flex; flex-direction: column; gap: 0.6rem; }
  .qa-input label { font-size: 0.72rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  .qa-input textarea { background: #0a0e17; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; padding: 0.7rem; font-size: 0.82rem; font-family: inherit; resize: none; height: 130px; line-height: 1.6; }
  .qa-input textarea:focus { outline: none; border-color: #0d9488; }
  .qa-input textarea::placeholder { color: #334155; }
  .qa-actions { display: flex; align-items: center; gap: 0.75rem; }
  .btn-gen { padding: 0.45rem 1.2rem; border-radius: 6px; background: #0d9488; color: #fff; font-size: 0.82rem; font-weight: 600; border: none; cursor: pointer; transition: background 0.15s; }
  .btn-gen:hover { background: #14b8a6; }
  .btn-gen:disabled { background: #134e4a; color: #4b7a77; cursor: not-allowed; }
  .btn-copy-all { padding: 0.4rem 0.9rem; border-radius: 6px; background: #1e293b; color: #94a3b8; font-size: 0.78rem; border: none; cursor: pointer; transition: background 0.15s; }
  .btn-copy-all:hover { background: #334155; color: #e2e8f0; }
  #gen-status { font-size: 0.78rem; color: #64748b; }
  .qa-output { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
  .qa-empty { color: #334155; font-size: 0.85rem; text-align: center; margin-top: 2rem; line-height: 1.8; }
  .qa-stream { font-size: 0.84rem; color: #e2e8f0; white-space: pre-wrap; line-height: 1.8; }
  .answer-card { background: #1e293b; border-radius: 8px; padding: 1rem 1.1rem; border-left: 3px solid #0d9488; }
  .answer-q { font-size: 0.75rem; font-weight: 700; color: #0d9488; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; }
  .answer-a { font-size: 0.85rem; color: #e2e8f0; line-height: 1.75; }
  .answer-footer { margin-top: 0.6rem; display: flex; justify-content: flex-end; }
  .btn-copy { padding: 0.25rem 0.65rem; border-radius: 4px; background: #0f1117; color: #475569; font-size: 0.72rem; border: 1px solid #334155; cursor: pointer; transition: all 0.15s; }
  .btn-copy:hover { color: #e2e8f0; border-color: #475569; }
  .cursor { display: inline-block; width: 2px; height: 1em; background: #0d9488; animation: blink 0.8s step-end infinite; vertical-align: text-bottom; margin-left: 1px; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
</style>
</head>
<body>
<header>
  <div>
    <h1>${headerTitle}</h1>
    <div class="meta">Application Q&amp;A &nbsp;·&nbsp; answers generated from your resume + this JD</div>
  </div>
</header>
<div class="workspace">
  <div class="pane pane-jd">
    <div class="pane-header">Job Description</div>
    ${hasJD
      ? `<div class="jd-body">${jdEsc}</div>`
      : `<div class="jd-body" style="display:flex;flex-direction:column;gap:0.75rem;padding:1rem">
           <div style="font-size:0.78rem;color:#64748b">No JD stored for this resume. Paste it here to get context-aware answers.</div>
           <textarea id="jd-paste" style="flex:1;background:#0a0e17;border:1px solid #334155;border-radius:6px;color:#e2e8f0;padding:0.7rem;font-size:0.78rem;font-family:inherit;resize:none;line-height:1.6" placeholder="Paste the job description here…"></textarea>
         </div>`
    }
  </div>
  <div class="pane pane-qa">
    <div class="pane-header">Q &amp; A</div>
    <div class="qa-body">
      <div class="qa-input">
        <label>Paste application questions (one per line, or numbered list)</label>
        <textarea id="questions" placeholder="Why do you want to work here?&#10;Describe your experience with X.&#10;What is your biggest strength?"></textarea>
        <div class="qa-actions">
          <button class="btn-gen" id="gen-btn" onclick="generate()">Generate Answers</button>
          <button class="btn-copy-all" id="copy-all-btn" onclick="copyAll()" style="display:none">Copy All</button>
          <span id="gen-status"></span>
        </div>
      </div>
      <div class="qa-output" id="qa-output">
        <div class="qa-empty" id="qa-empty">Paste your questions above and click <strong>Generate Answers</strong>.<br>Answers are tailored to this JD and your resume.</div>
      </div>
    </div>
  </div>
</div>
<script>
  const API_URL = '${resolvedApiUrl}';
  let allAnswersText = '';

  async function generate() {
    const qs = document.getElementById('questions').value.trim();
    if (!qs) { document.getElementById('gen-status').textContent = 'Paste some questions first.'; return; }

    const btn    = document.getElementById('gen-btn');
    const status = document.getElementById('gen-status');
    const output = document.getElementById('qa-output');
    const empty  = document.getElementById('qa-empty');

    btn.disabled  = true;
    btn.textContent = 'Generating…';
    status.textContent = '';
    allAnswersText = '';
    if (empty) empty.remove();

    // streaming container
    const streamDiv = document.createElement('div');
    streamDiv.className = 'qa-stream';
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    output.innerHTML = '';
    output.appendChild(streamDiv);
    streamDiv.appendChild(cursor);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: qs, jd: (document.getElementById('jd-paste') || {}).value || '' })
      });

      if (!res.ok) { throw new Error('Server error ' + res.status); }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        for (const line of text.split('\\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') break;
          buf += payload + '\\n';
          streamDiv.textContent = buf;
          streamDiv.appendChild(cursor);
          output.scrollTop = output.scrollHeight;
        }
      }

      allAnswersText = buf;
      cursor.remove();
      renderCards(buf, output);
      document.getElementById('copy-all-btn').style.display = '';
    } catch (err) {
      streamDiv.textContent = 'Error: ' + err.message;
      cursor.remove();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Answers';
    }
  }

  function renderCards(text, container) {
    container.innerHTML = '';
    // Split on **Q: or Q: headers
    const blocks = text.split(/(?=\\*\\*Q:|^Q:)/m).filter(s => s.trim());
    if (blocks.length <= 1) {
      // No card structure — just show as-is
      const div = document.createElement('div');
      div.className = 'answer-card';
      div.innerHTML = '<div class="answer-a">' + escHtml(text.trim()) + '</div>';
      addCopyBtn(div, text.trim());
      container.appendChild(div);
      return;
    }
    for (const block of blocks) {
      const card = document.createElement('div');
      card.className = 'answer-card';
      const qMatch = block.match(/^\\*?\\*?Q:?\\*?\\*?\\s*(.+?)\\n/);
      const aMatch = block.match(/\\nA:\\s*([\\s\\S]+)/);
      if (qMatch && aMatch) {
        card.innerHTML =
          '<div class="answer-q">' + escHtml(qMatch[1].trim()) + '</div>' +
          '<div class="answer-a">'  + escHtml(aMatch[1].trim()) + '</div>';
      } else {
        card.innerHTML = '<div class="answer-a">' + escHtml(block.trim()) + '</div>';
      }
      addCopyBtn(card, block.replace(/^\\*?\\*?Q:?\\*?\\*?/, 'Q:'));
      container.appendChild(card);
    }
  }

  function addCopyBtn(card, text) {
    const footer = document.createElement('div');
    footer.className = 'answer-footer';
    const btn = document.createElement('button');
    btn.className = 'btn-copy';
    btn.textContent = 'Copy';
    btn.onclick = () => { navigator.clipboard.writeText(text.trim()); btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); };
    footer.appendChild(btn);
    card.appendChild(footer);
  }

  function copyAll() {
    navigator.clipboard.writeText(allAnswersText.trim());
    const btn = document.getElementById('copy-all-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy All', 1500);
  }

  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>'); }
</script>
</body>
</html>`;
}

function buildHTML(pdfs, map, queue) {
  const pending = queue.filter(q => ['pending','processing'].includes(q.status)).length;

  const rows = pdfs.map(({ file, relKey, fileKey, rel, date }) => {
    const info    = map[relKey] || map[fileKey] || {};
    const company = info.company  || '—';
    const role    = info.role     || '—';
    const loc     = info.location || '—';
    const score   = info.score   || null;
    const badge   = date || 'older';
    const n = score ? parseFloat(score) : 0;
    const scoreClass = !score ? 'score-none' : n >= 4.0 ? 'score-great' : n >= 3.0 ? 'score-good' : n >= 2.5 ? 'score-ok' : 'score-low';
    const scoreHtml = score
      ? `<span class="score-badge ${scoreClass}">${score}</span>`
      : `<span class="score-none">—</span>`;
    const qaBtn = info.jd
      ? `<a class="btn btn-teal" href="/qa-resume?k=${encodeURIComponent(relKey || fileKey)}" target="_blank">QA</a>`
      : '';
    return `
    <tr>
      <td><span class="date-badge">${badge}</span></td>
      <td><span class="company-name">${company}</span></td>
      <td><span class="role-text">${role}</span></td>
      <td><span class="loc-text">${loc}</span></td>
      <td>${scoreHtml}</td>
      <td><div class="btn-actions"><a class="btn btn-primary" href="/pdf/${encodeURIComponent(rel)}" target="_blank">PDF</a>${qaBtn}</div></td>
      <td><span class="fname-text">${file}</span></td>
    </tr>`;
  }).join('');

  // Show pending/processing/error/skip — only done is auto-removed
  const activeQueue = queue.filter(q => q.status !== 'done');
  const hasProcessing = activeQueue.some(q => q.status === 'processing');

  const queueRows = activeQueue.length === 0
    ? `<tr class="empty-row"><td colspan="5">Queue is empty — paste a JD above to get started.</td></tr>`
    : activeQueue.map(item => {
        const preview      = (item.jd || '').trim().slice(0, 110).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const isProcessing = item.status === 'processing';
        const isSkip       = item.status === 'skip';
        const isError      = item.status === 'error';
        const chipClass    = isSkip ? 'status-skip' : isError ? 'status-error' : isProcessing ? 'status-processing' : 'status-pending';
        const spinner      = isProcessing ? '<span class="spin">⟳</span>' : '';
        const statusLabel  = isProcessing ? (item.step || 'Processing…')
                           : isSkip       ? (item.step || 'Below threshold')
                           : isError      ? (item.step || 'Error')
                           : 'Pending';
        const roleCell = isSkip && item.role
          ? `<span style="color:var(--text-3);font-size:0.78rem;font-weight:400"> — ${item.role}</span>`
          : '';
        const effortBadge = item.effort === 'hard'
          ? `<span style="margin-left:0.4rem;font-size:0.68rem;font-weight:700;padding:0.1rem 0.45rem;border-radius:10px;background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.2)">HARD</span>`
          : `<span style="margin-left:0.4rem;font-size:0.68rem;font-weight:700;padding:0.1rem 0.45rem;border-radius:10px;background:rgba(245,158,11,0.12);color:#fbbf24;border:1px solid rgba(245,158,11,0.2)">MED</span>`;
        return `
        <tr id="row-${item.id}">
          <td><span class="loc-text">${(item.added || '').slice(0, 16).replace('T', ' ')}</span></td>
          <td><span class="company-name">${item.company || '—'}</span>${roleCell}${effortBadge}</td>
          <td><span class="preview-text">${preview}…</span></td>
          <td><div id="step-${item.id}"><span class="status-chip ${chipClass}">${spinner} ${statusLabel}</span></div></td>
          <td>
            <div class="btn-actions">
              ${isProcessing ? '' : `<button class="btn btn-danger" onclick="removeItem('${item.id}')">✕</button>`}
              <a class="btn btn-teal" href="/qa/${item.id}" target="_blank">QA</a>
              ${isSkip ? `<button class="btn btn-purple" onclick="forceGenerate('${item.id}')">Generate anyway</button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jobz — Vikram Parmar</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root, [data-theme="dark"] {
    --bg:        #0c1220;
    --surface:   #111827;
    --surface-2: #1a2236;
    --surface-3: #1e2d45;
    --border:    #1e2d45;
    --border-2:  #243044;
    --primary:   #3b82f6;
    --primary-h: #60a5fa;
    --success:   #10b981;
    --success-h: #34d399;
    --warning:   #f59e0b;
    --danger:    #ef4444;
    --danger-h:  #f87171;
    --purple:    #8b5cf6;
    --purple-h:  #a78bfa;
    --text-1:    #f1f5f9;
    --text-2:    #94a3b8;
    --text-3:    #64748b;
    --text-4:    #3d5068;
    --radius:    8px;
    --radius-sm: 5px;
    --radius-lg: 12px;
  }
  [data-theme="light"] {
    --bg:        #f1f5f9;
    --surface:   #ffffff;
    --surface-2: #f8fafc;
    --surface-3: #f1f5f9;
    --border:    #e2e8f0;
    --border-2:  #cbd5e1;
    --text-1:    #0f172a;
    --text-2:    #475569;
    --text-3:    #94a3b8;
    --text-4:    #cbd5e1;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg); color: var(--text-1);
    min-height: 100vh; font-size: 0.875rem; line-height: 1.6;
  }

  /* ── Header ── */
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 0 2rem;
    display: flex; align-items: center; justify-content: space-between;
    height: 60px; position: sticky; top: 0; z-index: 100;
  }
  .header-left { display: flex; align-items: center; gap: 0.75rem; }
  .logo-mark {
    width: 32px; height: 32px; border-radius: var(--radius-sm);
    background: linear-gradient(135deg, var(--primary) 0%, var(--purple) 100%);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 0.8rem; color: #fff; letter-spacing: -0.02em; flex-shrink: 0;
  }
  .header-title { font-weight: 700; font-size: 0.95rem; color: var(--text-1); letter-spacing: -0.01em; }
  .header-sub   { font-size: 0.75rem; color: var(--text-3); }
  .header-stats { display: flex; align-items: center; gap: 0.5rem; }
  .stat-chip {
    display: flex; align-items: center; gap: 0.35rem;
    background: var(--surface-2); border: 1px solid var(--border-2);
    border-radius: 20px; padding: 0.25rem 0.7rem;
    font-size: 0.75rem; font-weight: 500; color: var(--text-2);
    transition: border-color 0.15s;
  }
  .stat-chip .dot { width: 6px; height: 6px; border-radius: 50%; }
  .dot-blue   { background: var(--primary); }
  .dot-orange { background: var(--warning); }
  .refresh-btn {
    display: flex; align-items: center; gap: 0.3rem;
    background: var(--surface-2); border: 1px solid var(--border-2);
    border-radius: var(--radius-sm); padding: 0.3rem 0.65rem;
    font-size: 0.75rem; font-weight: 500; color: var(--text-3);
    cursor: pointer; text-decoration: none; transition: all 0.15s;
  }
  .refresh-btn:hover { border-color: var(--primary); color: var(--primary); }

  /* ── Main layout ── */
  .main { padding: 1.5rem 2rem 3rem; max-width: 1400px; }

  /* ── Tabs ── */
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; }
  .tab {
    padding: 0.7rem 1.1rem; font-size: 0.84rem; font-weight: 500; color: var(--text-3);
    cursor: pointer; border: none; border-bottom: 2px solid transparent; background: none;
    transition: color 0.15s, border-color 0.15s; display: flex; align-items: center; gap: 0.45rem;
    letter-spacing: -0.01em;
  }
  .tab.active { color: var(--primary); border-bottom-color: var(--primary); }
  .tab:hover:not(.active) { color: var(--text-2); }
  .tab-badge {
    background: var(--warning); color: #fff; border-radius: 10px;
    padding: 0.05rem 0.5rem; font-size: 0.65rem; font-weight: 700; line-height: 1.6;
  }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* ── Tables ── */
  .table-wrap { border-radius: var(--radius-lg); border: 1px solid var(--border); overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
  thead th {
    text-align: left; padding: 0.7rem 1rem; color: var(--text-3);
    font-weight: 600; font-size: 0.7rem; text-transform: uppercase;
    letter-spacing: 0.06em; background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  tbody tr { border-bottom: 1px solid var(--border); transition: background 0.12s; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--surface-2); }
  td { padding: 0.75rem 1rem; vertical-align: middle; }
  .empty-row td { text-align: center; color: var(--text-4); padding: 3rem 1rem; font-size: 0.85rem; }

  /* ── Date badge ── */
  .date-badge {
    display: inline-block; padding: 0.2rem 0.55rem; border-radius: var(--radius-sm);
    font-size: 0.7rem; font-weight: 600; background: var(--surface-3);
    color: var(--text-3); white-space: nowrap; letter-spacing: 0.02em; font-family: monospace;
  }

  /* ── Company / Role ── */
  .company-name { font-weight: 700; color: var(--text-1); letter-spacing: -0.01em; }
  .role-text    { color: var(--text-2); font-size: 0.82rem; }
  .loc-text     { color: var(--text-3); font-size: 0.8rem; }
  .fname-text   { color: var(--text-4); font-size: 0.72rem; font-family: monospace; }

  /* ── Score badge ── */
  .score-badge {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 0.2rem 0.6rem; border-radius: 20px;
    font-size: 0.78rem; font-weight: 700; letter-spacing: 0.01em; white-space: nowrap;
  }
  .score-great  { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.25); }
  .score-good   { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.25); }
  .score-ok     { background: rgba(249,115,22,0.15); color: #fb923c; border: 1px solid rgba(249,115,22,0.2); }
  .score-low    { background: rgba(239,68,68,0.12);  color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
  .score-none   { color: var(--text-4); font-size: 0.8rem; }

  /* ── Status chip (queue) ── */
  .status-chip {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.2rem 0.6rem; border-radius: 20px;
    font-size: 0.72rem; font-weight: 600; white-space: nowrap;
  }
  .status-pending    { background: rgba(100,116,139,0.15); color: #94a3b8; border: 1px solid rgba(100,116,139,0.2); }
  .status-processing { background: rgba(59,130,246,0.15);  color: #60a5fa; border: 1px solid rgba(59,130,246,0.25); }
  .status-skip       { background: rgba(245,158,11,0.15);  color: #fbbf24; border: 1px solid rgba(245,158,11,0.25); }
  .status-error      { background: rgba(239,68,68,0.12);   color: #f87171; border: 1px solid rgba(239,68,68,0.2); }

  /* ── Buttons ── */
  .btn {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.32rem 0.8rem; border-radius: var(--radius-sm);
    font-family: inherit; font-size: 0.78rem; font-weight: 600;
    cursor: pointer; border: none; text-decoration: none;
    transition: all 0.15s; white-space: nowrap; line-height: 1.4;
  }
  .btn-primary { background: var(--primary);  color: #fff; }
  .btn-primary:hover { background: var(--primary-h); }
  .btn-success { background: var(--success);  color: #fff; }
  .btn-success:hover { background: var(--success-h); }
  .btn-danger  { background: rgba(239,68,68,0.15); color: var(--danger); border: 1px solid rgba(239,68,68,0.25); }
  .btn-danger:hover { background: var(--danger); color: #fff; }
  .btn-teal    { background: #0d9488; color: #fff; }
  .btn-teal:hover { background: #14b8a6; }
  .btn-purple  { background: rgba(139,92,246,0.15); color: var(--purple); border: 1px solid rgba(139,92,246,0.25); }
  .btn-purple:hover { background: var(--purple); color: #fff; }
  .btn-ghost   { background: var(--surface-3); color: var(--text-2); border: 1px solid var(--border-2); }
  .btn-ghost:hover { border-color: var(--primary); color: var(--primary); }
  .btn-actions { display: flex; gap: 0.4rem; align-items: center; }

  /* ── JD Form ── */
  .form-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 1.5rem; margin-bottom: 1.5rem;
  }
  .form-card-title {
    font-size: 0.82rem; font-weight: 700; color: var(--text-2);
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 1rem;
  }
  .field { margin-bottom: 1rem; }
  .field label {
    display: block; font-size: 0.75rem; font-weight: 600; color: var(--text-3);
    margin-bottom: 0.35rem; letter-spacing: 0.02em;
  }
  /* ── Effort toggle ── */
  .effort-toggle { display: flex; gap: 0.4rem; }
  .effort-btn {
    padding: 0.35rem 1rem; border-radius: var(--radius-sm);
    font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit;
    border: 1px solid var(--border-2); background: var(--surface-2); color: var(--text-3);
    transition: all 0.15s;
  }
  .effort-btn.active[data-effort="med"]  { border-color: var(--warning);  background: rgba(245,158,11,0.1); color: var(--warning); }
  .effort-btn.active[data-effort="hard"] { border-color: var(--danger);   background: rgba(239,68,68,0.1);  color: var(--danger); }
  .effort-btn:not(.active):hover { border-color: var(--text-3); color: var(--text-2); }
  .field input[type="text"] {
    width: 100%; background: var(--bg); border: 1px solid var(--border-2);
    border-radius: var(--radius-sm); color: var(--text-1);
    padding: 0.55rem 0.85rem; font-size: 0.84rem; font-family: inherit;
    transition: border-color 0.15s;
  }
  .field textarea {
    width: 100%; height: 200px; background: var(--bg); border: 1px solid var(--border-2);
    border-radius: var(--radius-sm); color: var(--text-1); padding: 0.75rem 0.85rem;
    font-size: 0.82rem; font-family: 'SF Mono', 'Fira Code', monospace;
    resize: vertical; line-height: 1.6; transition: border-color 0.15s;
  }
  .field input:focus, .field textarea:focus { outline: none; border-color: var(--primary); }
  .field input::placeholder, .field textarea::placeholder { color: var(--text-4); }
  .form-footer { display: flex; gap: 0.75rem; align-items: center; }
  #add-status { font-size: 0.8rem; color: var(--text-3); }

  /* ── Log panel ── */
  .log-card {
    background: #080d16; border: 1px solid var(--border);
    border-radius: var(--radius); margin-top: 1.25rem; overflow: hidden;
  }
  .log-header {
    padding: 0.5rem 1rem; background: var(--surface-2); border-bottom: 1px solid var(--border);
    font-size: 0.68rem; font-weight: 600; color: var(--text-4);
    text-transform: uppercase; letter-spacing: 0.08em;
    display: flex; align-items: center; gap: 0.4rem;
  }
  .log-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .log-body {
    padding: 0.75rem 1rem; font-family: 'SF Mono','Fira Code','Cascadia Code',monospace;
    font-size: 0.72rem; color: var(--text-3); max-height: 160px; overflow-y: auto;
    line-height: 1.7;
  }
  .log-line        { white-space: pre-wrap; }
  .log-line.step   { color: #60a5fa; }
  .log-line.done   { color: #34d399; }
  .log-line.err    { color: #f87171; }

  /* ── Spinner ── */
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { display: inline-block; animation: spin 0.8s linear infinite; }

  /* ── Preview text ── */
  .preview-text {
    font-size: 0.78rem; color: var(--text-3); max-width: 280px;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  .step-text { font-size: 0.78rem; font-weight: 500; max-width: 320px; }
</style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      <div class="logo-mark">Jz</div>
      <div>
        <div class="header-title">Jobz</div>
        <div class="header-sub">Vikram Kumar Parmar</div>
      </div>
    </div>
    <div class="header-stats">
      <div class="stat-chip"><span class="dot dot-blue"></span>${pdfs.length} resumes</div>
      ${pending > 0 ? `<div class="stat-chip"><span class="dot dot-orange"></span>${pending} queued</div>` : ''}
      <button class="refresh-btn" id="theme-toggle" onclick="toggleTheme()" title="Toggle theme">🌙</button>
      <a class="refresh-btn" href="/">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        Refresh
      </a>
    </div>
  </header>

  <div class="main">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('resumes', this)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
        All Resumes
      </button>
      <button id="tab-btn-queue" class="tab" onclick="switchTab('queue', this)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        JD Queue
        ${pending > 0 ? `<span class="tab-badge">${pending}</span>` : ''}
      </button>
    </div>

    <!-- TAB: All Resumes -->
    <div id="tab-resumes" class="tab-content active">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Company</th>
              <th>Role</th>
              <th>Location</th>
              <th>Score</th>
              <th>Actions</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr class="empty-row"><td colspan="7">No resumes yet — add a JD to the queue to get started.</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <!-- TAB: JD Queue -->
    <div id="tab-queue" class="tab-content">
      <div class="form-card">
        <div class="form-card-title">Add Job Description</div>
        <div class="field">
          <label>Company / Role hint (optional)</label>
          <input type="text" id="jd-company" placeholder="e.g. Stripe — Senior Data Engineer">
        </div>
        <div class="field">
          <label>Effort Level</label>
          <div class="effort-toggle">
            <button type="button" class="effort-btn active" data-effort="med" onclick="setEffort('med', this)">Med — skills only</button>
            <button type="button" class="effort-btn" data-effort="hard" onclick="setEffort('hard', this)">Hard — all keywords</button>
          </div>
        </div>
        <div class="field">
          <label>Job Description</label>
          <textarea id="jd-text" placeholder="Paste the full job description here…"></textarea>
        </div>
        <div class="form-footer">
          <button class="btn btn-success" onclick="addJD()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add to Queue
          </button>
          <span id="add-status"></span>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Added</th>
              <th>Company</th>
              <th>JD Preview</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="queue-body">${queueRows}</tbody>
        </table>
      </div>

      <div class="log-card" id="log-panel" style="${hasProcessing ? '' : 'display:none'}">
        <div class="log-header"><span class="log-dot"></span> Worker Log</div>
        <div class="log-body" id="log-lines">loading…</div>
      </div>
    </div>
  </div>

<script>
  function switchTab(name, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    btn.classList.add('active');
  }

  function setEffort(val, btn) {
    document.querySelectorAll('.effort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  async function addJD() {
    const jd      = document.getElementById('jd-text').value.trim();
    const company = document.getElementById('jd-company').value.trim();
    const effort  = document.querySelector('.effort-btn.active')?.dataset.effort || 'med';
    const status  = document.getElementById('add-status');
    if (!jd) { status.textContent = 'Paste a JD first.'; return; }
    status.textContent = 'Adding…';
    try {
      const res = await fetch('/api/jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jd, company, effort })
      });
      if (res.ok) {
        document.getElementById('jd-text').value    = '';
        document.getElementById('jd-company').value = '';
        status.style.color = '#22c55e';
        status.textContent = '✓ Added to queue!';
        setTimeout(() => location.reload(), 700);
      } else {
        status.textContent = 'Error — try again.';
      }
    } catch { status.textContent = 'Network error.'; }
  }

  async function removeItem(id) {
    await fetch('/api/jd/' + id, { method: 'DELETE' });
    location.reload();
  }

  async function forceGenerate(id) {
    await fetch('/api/jd/' + id + '/force', { method: 'POST' });
    location.reload();
  }

  // Auto-refresh every 30s — pause if user is actively typing in a field
  let refreshTimer;
  function resetRefreshTimer() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => location.reload(), 30000);
  }
  document.addEventListener('keydown', resetRefreshTimer);
  document.addEventListener('input', resetRefreshTimer);
  resetRefreshTimer();

  // Live polling when items are processing
  const HAS_PROCESSING = ${hasProcessing};
  if (HAS_PROCESSING) {
    document.getElementById('tab-btn-queue').click();

    async function pollProgress() {
      try {
        // Refresh queue steps
        const q = await fetch('/api/queue').then(r => r.json());
        const active = q.filter(x => ['pending','processing','error'].includes(x.status));
        const stillProcessing = active.some(x => x.status === 'processing');

        for (const item of active) {
          const stepEl = document.getElementById('step-' + item.id);
          if (stepEl && item.step) {
            const isProc = item.status === 'processing';
            const cls = isProc ? 'status-processing' : item.status === 'error' ? 'status-error' : 'status-skip';
            stepEl.innerHTML = '<span class="status-chip ' + cls + '">' + (isProc ? '<span class="spin">⟳</span> ' : '') + item.step + '</span>';
          }
        }

        // Refresh log
        const logEl = document.getElementById('log-lines');
        const logPanel = document.getElementById('log-panel');
        if (logEl) {
          const log = await fetch('/api/worker-log').then(r => r.text());
          const lines = log.trim().split('\\n').slice(-20);
          logEl.innerHTML = lines.map(function(l) {
            const cls = l.includes('▸') || l.includes('[') ? 'step' : (l.includes('✓') || l.includes('Done')) ? 'done' : l.includes('ERROR') ? 'err' : '';
            return '<div class="log-line ' + cls + '">' + l.replace(/</g,'&lt;') + '</div>';
          }).join('');
          logEl.scrollTop = logEl.scrollHeight;
          if (stillProcessing) logPanel.style.display = '';
        }

        if (stillProcessing) {
          setTimeout(pollProgress, 3000);
        } else {
          // All done — reload page to show new resumes
          setTimeout(() => location.reload(), 1500);
        }
      } catch { setTimeout(pollProgress, 5000); }
    }

    setTimeout(pollProgress, 2000);
  }

  // ── Theme toggle ──
  (function() {
    const saved = localStorage.getItem('jobz-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
  })();

  function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('jobz-theme', next);
    document.getElementById('theme-toggle').textContent = next === 'dark' ? '☀️' : '🌙';
  }
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url);

  // GET /qa/:id — QA page for a queue item
  if (req.method === 'GET' && url.startsWith('/qa/')) {
    const id   = url.slice(4);
    const item = loadQueue().find(q => q.id === id);
    if (!item) { res.writeHead(404); res.end('Item not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildQAPage(item));
    return;
  }

  // POST /api/qa/:id — stream claude answers for application questions
  if (req.method === 'POST' && url.startsWith('/api/qa/')) {
    const id   = url.slice(8);
    const item = loadQueue().find(q => q.id === id);
    if (!item) { res.writeHead(404); res.end('Item not found'); return; }
    const body = await readBody(req);
    if (!body.questions) { res.writeHead(400); res.end('Missing questions'); return; }

    let cv = '';
    try { cv = fs.readFileSync(path.join(__dirname, 'cv.md'), 'utf8'); } catch {}

    const company = item.company || 'this company';
    const role    = item.role    || 'this role';
    const prompt  = `You are helping Vikram Kumar Parmar answer job application questions.

RESUME:
${cv}

JOB DESCRIPTION:
${item.jd || '(not available)'}

APPLICATION QUESTIONS:
${body.questions}

Answer each question in 2-5 sentences. Write like a real person talking to a recruiter — direct, specific, slightly conversational. Use concrete numbers and examples from the resume. Vary sentence structure; don't start every answer the same way.

Format each answer as:
**Q: [exact question]**
A: [answer]

Hard rules:
- BANNED words: Spearheaded, Leveraged, Architected, Engineered, Drove adoption, Utilized, Facilitated, Implemented, Robust, Seamless, Passionate about, Results-oriented, Proven track record
- Use instead: Built, Led, Ran, Set up, Designed, Wrote, Shipped, Cut, Grew — short punchy verbs
- No corporate filler ("I am excited to...", "I believe I would be a great fit...")
- No fluffy openers — get straight to the point
- Sound like a confident engineer, not a cover letter
- If a question asks about salary or visa: leave a [FILL IN] placeholder
- Answer every question even if it requires some inference`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const claude = spawn('claude', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    claude.stdout.on('data', chunk => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) res.write('data: ' + line + '\n');
      res.write('\n');
    });
    claude.stderr.on('data', () => {});
    claude.on('close', () => { res.write('data: [DONE]\n\n'); res.end(); });
    claude.on('error', err => { res.write('data: Error: ' + err.message + '\n\ndata: [DONE]\n\n'); res.end(); });
    return;
  }

  // GET /qa-resume?k=<mapKey> — QA page for a generated resume
  if (req.method === 'GET' && url.startsWith('/qa-resume')) {
    const mapKey = new URL('http://x' + url).searchParams.get('k') || '';
    const map    = loadMap();
    const info   = map[mapKey];
    const fakeItem = { id: '', jd: info?.jd || '', company: info?.company || '', role: info?.role || '' };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildQAPage(fakeItem, `/api/qa-resume?k=${encodeURIComponent(mapKey)}`));
    return;
  }

  // POST /api/qa-resume?k=<mapKey> — stream answers for a generated resume
  if (req.method === 'POST' && url.startsWith('/api/qa-resume')) {
    const mapKey = new URL('http://x' + url).searchParams.get('k') || '';
    const map    = loadMap();
    const info   = map[mapKey];
    const body = await readBody(req);
    if (!body.questions) { res.writeHead(400); res.end('Missing questions'); return; }
    const jd = (info?.jd) || body.jd || '';

    let cv = '';
    try { cv = fs.readFileSync(path.join(__dirname, 'cv.md'), 'utf8'); } catch {}

    const company = info?.company || 'this company';
    const prompt  = `You are helping Vikram Kumar Parmar answer job application questions.

RESUME:
${cv}

JOB DESCRIPTION:
${jd}

APPLICATION QUESTIONS:
${body.questions}

Answer each question in 2-5 sentences. Write like a real person talking to a recruiter — direct, specific, slightly conversational. Use concrete numbers and examples from the resume. Vary sentence structure; don't start every answer the same way.

Format each answer as:
**Q: [exact question]**
A: [answer]

Hard rules:
- BANNED words: Spearheaded, Leveraged, Architected, Engineered, Drove adoption, Utilized, Facilitated, Implemented, Robust, Seamless, Passionate about, Results-oriented, Proven track record
- Use instead: Built, Led, Ran, Set up, Designed, Wrote, Shipped, Cut, Grew — short punchy verbs
- No corporate filler ("I am excited to...", "I believe I would be a great fit...")
- No fluffy openers — get straight to the point
- Sound like a confident engineer, not a cover letter
- If a question asks about salary or visa: leave a [FILL IN] placeholder
- Answer every question even if it requires some inference`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const claude = spawn('claude', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    claude.stdout.on('data', chunk => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) res.write('data: ' + line + '\n');
      res.write('\n');
    });
    claude.stderr.on('data', () => {});
    claude.on('close', () => { res.write('data: [DONE]\n\n'); res.end(); });
    claude.on('error', err => { res.write('data: Error: ' + err.message + '\n\ndata: [DONE]\n\n'); res.end(); });
    return;
  }

  // POST /api/jd — add JD to queue
  if (req.method === 'POST' && url === '/api/jd') {
    const body = await readBody(req);
    if (!body.jd) { res.writeHead(400); res.end('Bad Request'); return; }
    const queue = loadQueue();
    queue.push({
      id:      randomUUID(),
      added:   new Date().toISOString(),
      jd:      body.jd,
      company: body.company || '',
      effort:  body.effort === 'hard' ? 'hard' : 'med',
      status:  'pending'
    });
    saveQueue(queue);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /api/jd/:id/force — re-queue a skipped item, bypassing score threshold
  if (req.method === 'POST' && url.includes('/force')) {
    const id    = url.replace('/api/jd/', '').replace('/force', '');
    const queue = loadQueue();
    const item  = queue.find(q => q.id === id);
    if (item) { item.status = 'pending'; item.step = ''; item.force = true; saveQueue(queue); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // DELETE /api/jd/:id — remove item from queue
  if (req.method === 'DELETE' && url.startsWith('/api/jd/')) {
    const id    = url.slice(8);
    const queue = loadQueue().filter(item => item.id !== id);
    saveQueue(queue);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /api/queue — return queue as JSON
  if (url === '/api/queue') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadQueue()));
    return;
  }

  // GET /api/worker-log — last 30 lines of worker log
  if (url === '/api/worker-log') {
    const LOG_FILE = path.join(__dirname, 'data', 'worker.log');
    let content = '';
    try { content = fs.readFileSync(LOG_FILE, 'utf8'); } catch {}
    const lines = content.trim().split('\n').slice(-30).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(lines);
    return;
  }

  // Serve PDF files
  if (url.startsWith('/pdf/')) {
    const rel  = url.slice(5);
    const full = path.resolve(OUTPUT_DIR, rel);
    if (!full.startsWith(OUTPUT_DIR + path.sep) && full !== OUTPUT_DIR) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!fs.existsSync(full)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    fs.createReadStream(full).pipe(res);
    return;
  }

  // Serve dashboard
  if (url === '/' || url === '') {
    const map   = loadMap();
    const pdfs  = scanPDFs();
    const queue = loadQueue();
    const html  = buildHTML(pdfs, map, queue);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ============================================================
//  AUTO QUEUE PROCESSOR — polls every 30s, spawns worker
// ============================================================
let workerRunning = false;

function spawnWorker() {
  if (workerRunning) return;
  const queue = loadQueue();
  const pending = queue.filter(q => q.status === 'pending');
  if (pending.length === 0) return;

  console.log(`[auto] ${pending.length} pending JD(s) — spawning queue-worker`);
  workerRunning = true;

  const worker = spawn('node', [path.join(__dirname, 'queue-worker.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  worker.stdout.on('data', d => process.stdout.write('[worker] ' + d));
  worker.stderr.on('data', d => process.stderr.write('[worker] ' + d));

  worker.on('close', code => {
    console.log(`[auto] worker exited (code ${code})`);
    workerRunning = false;
  });
}

setInterval(spawnWorker, 30_000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Resume tracker running → http://localhost:${PORT}`);
  console.log(`Auto-processor: checks queue every 30s and spawns claude -p workers`);
});
