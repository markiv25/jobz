# Modo: pdf — Generación de PDF ATS-Optimizado (pipeline LaTeX)

## Pipeline completo

1. Lee `cv.md` como fuentes de verdad
2. Pide al usuario el JD si no está en contexto (texto o URL)
3. Extrae 15-20 keywords del JD
4. Detecta idioma del JD → idioma del CV (EN default)
5. Formato papel: **fijo en `letterpaper`** (definido en la preamble del template LaTeX). No cambiar: el usuario quiere preservar el diseño actual.
6. Detecta arquetipo del rol → adapta framing
7. Reescribe Professional Summary inyectando keywords del JD (NUNCA inventes skills; solo reformula experiencia real)
8. Selecciona top 3-4 proyectos más relevantes para la oferta
9. Reordena bullets de experiencia por relevancia al JD
10. Reordena/ajusta las categorías de Skills para que las palabras clave del JD aparezcan primero
11. Inyecta keywords naturalmente en logros existentes (NUNCA inventa)
12. Genera `.tex` completo desde `templates/VikramParmar_Resume_v21.tex` + contenido personalizado. **Escapa caracteres especiales de LaTeX** en todo el texto inyectado: `%` → `\%`, `&` → `\&`, `_` → `\_`, `#` → `\#`, `$` → `\$`, `~` → `\textasciitilde{}`, `^` → `\textasciicircum{}`, `\` → `\textbackslash{}`. Para URLs usa `\href{https://full-url}{display-text}`.
13. **Determina el próximo número `{N}`** — usa el contador atómico para evitar colisiones con agentes paralelos:
    - Ejecuta: `node get-resume-n.mjs` → imprime el número único reservado para este agente
    - Si el usuario especificó un nombre custom (ej. "tmobile"), usa ese nombre en vez de `{N}` y NO llames al script
    - Rango válido: `0–100`. Si `{N}` > 100, avisa al usuario y pregunta si rotar/limpiar.
14. Escribe el `.tex` a `/tmp/vikram_parmar_resume_{N}.tex` (filename del `.tex` y del `.pdf` SIEMPRE comparten el mismo `{N}` para que sea fácil rastrear el fuente)
15. Determina la carpeta de salida con la fecha de hoy: `output/$(date +%Y-%m-%d)/`. El script de compilación la crea automáticamente si no existe.
    Ejecuta: `node generate-pdf-latex.mjs /tmp/vikram_parmar_resume_{N}.tex output/$(date +%Y-%m-%d)/vikram_parmar_resume_{N}.pdf`
16. **Registra la asociación `{N} → {company}-{role}`** en la entrada del tracker (columna PDF/Notes) para que el tracker pueda mapear el número de resume al puesto. Ejemplo en `data/applications.md`: `vikram_parmar_resume_5.pdf` en columna PDF y "Crusoe — Sr Data Platform" en notas.
17. **Verifica 1 página**: si tectonic produce más de 1 página, condensa bullets más largos (NUNCA elimines logros; reformula más conciso) y recompila hasta que quepa en 1 página.
18. Reporta: ruta del PDF (`output/vikram_parmar_resume_{N}.pdf`), nº páginas, % cobertura de keywords, y el mapeo `{N} → {company}-{role}`.

## Reglas ATS (parseo limpio)

- Layout single-column (sin sidebars, sin columnas paralelas)
- Headers estándar: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- Sin texto en imágenes/SVGs
- Sin info crítica en headers/footers del PDF (ATS los ignora)
- UTF-8, texto seleccionable (no rasterizado)
- Sin tablas anidadas
- Keywords del JD distribuidas: Summary (top 5), primer bullet de cada rol, Skills section

## Diseño del PDF (LaTeX — NO MODIFICAR)

El diseño está fijado en `templates/VikramParmar_Resume_v21.tex`. **No alteres la preamble, geometry, titleformat, ni los wrappers `{\small ...}`.** Solo cambia el texto inyectado en los placeholders.

- **Font family**: `helvet` con `\sfdefault` (Helvetica/sans-serif)
- **Base size**: `10.9pt`, `letterpaper`
- **Márgenes**: top 0.32in, bottom 0.32in, left 0.42in, right 0.42in
- **Headers de sección**: `\small\bfseries\uppercase` + regla horizontal de 0.6pt
- **Itemize**: leftmargin 1.1em, itemsep 1pt, label `\textbullet`
- **Links**: `colorlinks=true`, urlcolor/linkcolor `black` (hyperref)
- **Hyphenation**: deshabilitado (`hyphenpenalty=10000`)

## Orden de secciones (fijo en el template LaTeX)

1. Header (nombre + headline + contacto en una línea)
2. Professional Summary (3-4 líneas, keyword-dense)
3. Skills (categorías: Languages / Data Engineering / Databases / Cloud / Observability / AI)
4. Technical Experience (cronológico inverso, bullets reordenados por relevancia al JD)
5. Education
6. Projects (top 3-4 más relevantes)
7. Publications

## Estrategia de keyword injection (ético, basado en verdad)

Ejemplos de reformulación legítima:
- JD dice "RAG pipelines" y CV dice "LLM workflows with retrieval" → cambiar a "RAG pipeline design and LLM orchestration workflows"
- JD dice "MLOps" y CV dice "observability, evals, error handling" → cambiar a "MLOps and observability: evals, error handling, cost monitoring"
- JD dice "stakeholder management" y CV dice "collaborated with team" → cambiar a "stakeholder management across engineering, operations, and business"

**NUNCA añadir skills que el candidato no tiene. Solo reformular experiencia real con el vocabulario exacto del JD.**

## Template LaTeX

Usar el template en `templates/VikramParmar_Resume_v21.tex`. Reemplazar placeholders `<<...>>` con contenido personalizado (todo el texto debe estar pre-escapado para LaTeX — ver Step 12 arriba):

| Placeholder | Contenido |
|-------------|-----------|
| `<<NAME>>` | `candidate.full_name` de `profile.yml` |
| `<<HEADLINE>>` | Línea bajo el nombre, e.g. `Data Engineer \textbar{} Austin, TX` |
| `<<PHONE>>` | `candidate.phone` de `profile.yml` |
| `<<EMAIL>>` | `candidate.email` de `profile.yml` |
| `<<GITHUB_URL>>` | URL sin `https://` (e.g. `github.com/markiv25`) |
| `<<GITHUB_DISPLAY>>` | Texto a mostrar (mismo valor o más corto) |
| `<<LINKEDIN_URL>>` | URL sin `https://` (e.g. `linkedin.com/in/vikramparmar25`) |
| `<<LINKEDIN_DISPLAY>>` | Texto a mostrar |
| `<<SUMMARY_TEXT>>` | Summary personalizado con keywords (3-4 líneas, una sola línea de texto sin saltos) |
| `<<SKILLS_BLOCK>>` | Bloque crudo de LaTeX. Cada categoría en su propia línea separada por línea en blanco. Formato: `Languages: Python, SQL, Bash\n\nData Engineering: ...\n\nDatabases: ...` (etc.) |
| `<<EXPERIENCE_BLOCK>>` | Bloque crudo de LaTeX. Por cada rol: header con `\textbf{Company} \textbar{} Role` + fechas/ubicación, luego `\begin{itemize}` con los bullets reordenados, luego `\end{itemize}`, luego `\vspace{2pt}`. Replica exactamente el patrón del archivo original `templates/VikramParmar_Resume_v21.tex` |
| `<<EDUCATION_BLOCK>>` | Bloque crudo de LaTeX con cada degree |
| `<<PROJECTS_BLOCK>>` | Top 3-4 proyectos en formato LaTeX (cada uno `\textbf{name} -- descripción \href{url}{display}`) |
| `<<PUBLICATIONS_BLOCK>>` | Publicaciones en formato LaTeX |

**IMPORTANTE — preservar diseño:**
- No añadas/quites secciones (ya están definidas en la plantilla)
- No cambies `\section{...}`, `\titleformat`, ni los wrappers `{\small ...}` y `\medskip` que rodean los bloques
- El header de cada rol usa el patrón exacto del original: `\textbf{Company} \textbar{} Role\\\nDates \textbar{} Location` envuelto en `{\small ...}`, seguido de `\vspace{1pt}`, seguido de `{\small\begin{itemize} ... \end{itemize}}`
- Si todo no cabe en 1 página, **condensa bullets** (no elimines): junta dos métricas en una frase, recorta adjetivos, mantén números

## Canva CV Generation (optional)

If `config/profile.yml` has `canva_resume_design_id` set, offer the user a choice before generating:
- **"HTML/PDF (fast, ATS-optimized)"** — existing flow above
- **"Canva CV (visual, design-preserving)"** — new flow below

If the user has no `canva_resume_design_id`, skip this prompt and use the HTML/PDF flow.

### Canva workflow

#### Step 1 — Duplicate the base design

a. `export-design` the base design (using `canva_resume_design_id`) as PDF → get download URL
b. `import-design-from-url` using that download URL → creates a new editable design (the duplicate)
c. Note the new `design_id` for the duplicate

#### Step 2 — Read the design structure

a. `get-design-content` on the new design → returns all text elements (richtexts) with their content
b. Map text elements to CV sections by content matching:
   - Look for the candidate's name → header section
   - Look for "Summary" or "Professional Summary" → summary section
   - Look for company names from cv.md → experience sections
   - Look for degree/school names → education section
   - Look for skill keywords → skills section
c. If mapping fails, show the user what was found and ask for guidance

#### Step 3 — Generate tailored content

Same content generation as the HTML flow (Steps 1-11 above):
- Rewrite Professional Summary with JD keywords + exit narrative
- Reorder experience bullets by JD relevance
- Select top competencies from JD requirements
- Inject keywords naturally (NEVER invent)

**IMPORTANT — Character budget rule:** Each replacement text MUST be approximately the same length as the original text it replaces (within ±15% character count). If tailored content is longer, condense it. The Canva design has fixed-size text boxes — longer text causes overlapping with adjacent elements. Count the characters in each original element from Step 2 and enforce this budget when generating replacements.

#### Step 4 — Apply edits

a. `start-editing-transaction` on the duplicate design
b. `perform-editing-operations` with `find_and_replace_text` for each section:
   - Replace summary text with tailored summary
   - Replace each experience bullet with reordered/rewritten bullets
   - Replace competency/skills text with JD-matched terms
   - Replace project descriptions with top relevant projects
c. **Reflow layout after text replacement:**
   After applying all text replacements, the text boxes auto-resize but neighboring elements stay in place. This causes uneven spacing between work experience sections. Fix this:
   1. Read the updated element positions and dimensions from the `perform-editing-operations` response
   2. For each work experience section (top to bottom), calculate where the bullets text box ends: `end_y = top + height`
   3. The next section's header should start at `end_y + consistent_gap` (use the original gap from the template, typically ~30px)
   4. Use `position_element` to move the next section's date, company name, role title, and bullets elements to maintain even spacing
   5. Repeat for all work experience sections
d. **Verify layout before commit:**
   - `get-design-thumbnail` with the transaction_id and page_index=1
   - Visually inspect the thumbnail for: text overlapping, uneven spacing, text cut off, text too small
   - If issues remain, adjust with `position_element`, `resize_element`, or `format_text`
   - Repeat until layout is clean
d. Show the user the final preview and ask for approval
e. `commit-editing-transaction` to save (ONLY after user approval)

#### Step 5 — Export and download PDF

a. `export-design` the duplicate as PDF (format: a4 or letter based on JD location)
b. **IMMEDIATELY** download the PDF using Bash:
   ```bash
   curl -sL -o "output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf" "{download_url}"
   ```
   The export URL is a pre-signed S3 link that expires in ~2 hours. Download it right away.
c. Verify the download:
   ```bash
   file output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf
   ```
   Must show "PDF document". If it shows XML or HTML, the URL expired — re-export and retry.
d. Report: PDF path, file size, Canva design URL (for manual tweaking)

#### Error handling

- If `import-design-from-url` fails → fall back to HTML/PDF pipeline with message
- If text elements can't be mapped → warn user, show what was found, ask for manual mapping
- If `find_and_replace_text` finds no matches → try broader substring matching
- Always provide the Canva design URL so the user can edit manually if auto-edit fails

## Post-generación

Actualizar tracker si la oferta ya está registrada: cambiar PDF de ❌ a ✅.
