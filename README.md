# Jobz

AI-powered job search pipeline — evaluate offers, generate tailored LaTeX resumes, track applications, and answer application questions — all from your terminal.

---

## What It Does

- **Evaluates job offers** with a structured A-F scoring system (10 weighted dimensions)
- **Generates tailored PDFs** — LaTeX resumes customized per job description via Tectonic
- **Web dashboard** (`localhost:3131`) — dark/light theme, JD queue, live processing, QA answer generation
- **QA page** — paste application questions, get streaming Claude answers grounded in your resume + the JD
- **Scans portals** automatically (Greenhouse, Ashby, Lever)
- **Tracks everything** in a single source of truth

---

## Stack

- **Node.js** — all scripts (`.mjs`)
- **Claude Code / `claude -p`** — AI evaluation and resume tailoring
- **Tectonic** — LaTeX → PDF compiler
- **Playwright** — portal scraping
- **Pure HTML/CSS/JS** — web dashboard (no build tools)

---

## Setup

```bash
npm install
brew install tectonic
cp config/profile.example.yml config/profile.yml
cp templates/portals.example.yml portals.yml
# Create cv.md with your resume content
```

---

## Usage

### Web Dashboard

```bash
node resume-server.mjs
# http://localhost:3131
```

Paste a JD into the queue — the worker scores it, tailors your resume, compiles the PDF, and adds it to the tracker automatically.

### CLI

```bash
/jobz oferta     # evaluate a job posting
/jobz pdf        # generate a tailored PDF
/jobz scan       # scan portals for new listings
/jobz pipeline   # process pending URLs
/jobz tracker    # view application status
```

### PDF Generation

```bash
node get-resume-n.mjs                                         # get next N
node generate-pdf-latex.mjs /tmp/resume.tex output/resume.pdf
```

---

## Key Files

| File | Purpose |
|------|---------|
| `resume-server.mjs` | Web dashboard (Jobz UI) |
| `queue-worker.mjs` | JD queue processor + PDF compiler |
| `generate-pdf-latex.mjs` | LaTeX → PDF via Tectonic |
| `get-resume-n.mjs` | Atomic resume counter |
| `scan.mjs` | Zero-token portal scanner |
| `templates/cv-template.tex` | LaTeX resume template |
| `modes/` | AI prompt modes |
| `data/applications.md` | Application tracker |

---

## Credits

The backend pipeline — offer evaluation, portal scanning, batch processing, AI scoring, and tracker integrity — was built by **[Santiago (santifer)](https://github.com/santifer)** in [career-ops](https://github.com/santifer/career-ops). Go star it.

This repo adds a LaTeX/Tectonic PDF pipeline, the Jobz web dashboard (dark/light theme, JD queue, QA answer generation), and personal workflow tweaks by [Vikram Parmar](https://github.com/markiv25).

---

## License

MIT
