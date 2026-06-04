#!/usr/bin/env node

/**
 * generate-pdf-latex.mjs — LaTeX → PDF via Tectonic
 *
 * Usage:
 *   node generate-pdf-latex.mjs <input.tex> <output.pdf>
 *
 * Requires: `tectonic` on PATH (`brew install tectonic`).
 * Compiles the .tex file in a temp dir, then moves the resulting PDF
 * to the requested output path.
 */

import { spawn } from 'child_process';
import { resolve, dirname, basename, join } from 'path';
import { mkdtempSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(resolve(__dirname, 'output'), { recursive: true });

function runTectonic(texPath, workDir) {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('tectonic', ['-X', 'compile', '--keep-logs', '--outdir', workDir, texPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (b) => { stdout += b.toString(); });
    proc.stderr.on('data', (b) => { stderr += b.toString(); });
    proc.on('error', (err) => rejectP(err));
    proc.on('close', (code) => {
      if (code === 0) resolveP({ stdout, stderr });
      else rejectP(new Error(`tectonic exited with code ${code}\n${stderr || stdout}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let inputPath, outputPath;
  for (const a of args) {
    if (!inputPath) inputPath = a;
    else if (!outputPath) outputPath = a;
  }
  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf-latex.mjs <input.tex> <output.pdf>');
    process.exit(1);
  }
  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  console.log(`📄 Input:  ${inputPath}`);
  console.log(`📁 Output: ${outputPath}`);

  // Verify input file exists and is .tex
  try { statSync(inputPath); } catch { console.error(`Input file not found: ${inputPath}`); process.exit(1); }

  // Quick check that placeholders were substituted (warns; does not fail)
  const src = await readFile(inputPath, 'utf-8');
  const leftover = src.match(/<<[A-Z_]+>>/g);
  if (leftover && leftover.length) {
    console.warn(`⚠️  Unsubstituted placeholders detected: ${[...new Set(leftover)].join(', ')}`);
  }

  const workDir = mkdtempSync(join(tmpdir(), 'careerops-latex-'));
  try {
    await runTectonic(inputPath, workDir);
    const producedPdf = join(workDir, basename(inputPath).replace(/\.tex$/i, '.pdf'));
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(producedPdf, outputPath);
    const { size } = statSync(outputPath);
    console.log(`✅ PDF generated: ${outputPath}`);
    console.log(`📦 Size: ${(size / 1024).toFixed(1)} KB`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ PDF generation failed:', err.message);
  process.exit(1);
});
