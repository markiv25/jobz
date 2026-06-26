# User Profile Context -- jobz

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.
     
     Customize everything here: your archetypes, narrative,
     proof points, negotiation scripts, location policy.
     
     The system reads _shared.md (updatable) first, then this
     file (your overrides). Your customizations always win.
     ============================================================ -->

## Your Target Roles

<!-- Replace these with YOUR target roles. Examples:
     - Senior Backend Engineer / Staff Platform Engineer
     - AI Product Manager / Technical PM
     - Data Engineer / ML Engineer
     - DevOps / SRE / Platform
     Whatever you're optimizing for. -->

| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
| **AI Platform / LLMOps Engineer** | Evaluation, observability, reliability, pipelines | Someone who puts AI in production with metrics |
| **Agentic Workflows / Automation** | HITL, tooling, orchestration, multi-agent | Someone who builds reliable agent systems |
| **Technical AI Product Manager** | GenAI/Agents, PRDs, discovery, delivery | Someone who translates business to AI product |
| **AI Solutions Architect** | Hyperautomation, enterprise, integrations | Someone who designs end-to-end AI architectures |
| **AI Forward Deployed Engineer** | Client-facing, fast delivery, prototyping | Someone who delivers AI solutions to clients fast |
| **AI Transformation Lead** | Change management, adoption, org enablement | Someone who leads AI transformation in an org |

## Your Adaptive Framing

<!-- Map YOUR projects to each archetype. Example:
     | Platform / LLMOps | My monitoring dashboard project | article-digest.md |
     | Agentic | My chatbot with HITL escalation | cv.md section 3 | -->

| If the role is... | Emphasize about you... | Proof point sources |
|-------------------|------------------------|---------------------|
| Platform / LLMOps | Production systems builder, observability, evals | article-digest.md + cv.md |
| Agentic / Automation | Multi-agent orchestration, HITL, reliability | article-digest.md + cv.md |
| Technical AI PM | Product discovery, PRDs, metrics | cv.md + article-digest.md |
| Solutions Architect | System design, integrations, enterprise-ready | article-digest.md + cv.md |
| Forward Deployed Engineer | Fast delivery, client-facing, prototype to prod | cv.md + article-digest.md |
| AI Transformation Lead | Change management, team enablement, adoption | cv.md + article-digest.md |

## Your Exit Narrative

<!-- Replace with YOUR story. This frames everything. -->

Use the candidate's exit story from `config/profile.yml` to frame ALL content:
- **In PDF Summaries:** Bridge from past to future
- **In STAR stories:** Reference proof points from article-digest.md
- **In Draft Answers:** The transition narrative appears in the first response

## Your Cross-cutting Advantage

<!-- What's your "signature move"? What do you do that others can't? -->

Frame profile as **"Technical builder with real-world proof"** that adapts framing to the role.

## Your Portfolio / Demo

<!-- If you have a live demo, dashboard, or public project:
     url: https://yoursite.dev/demo
     password: demo-2026
     when_to_share: "LLMOps, AI Platform roles" -->

If you have a live demo/dashboard (check profile.yml), offer access in applications for relevant roles.

## Your Comp Targets

<!-- Research comp ranges for YOUR target roles -->

**General guidance:**
- Use WebSearch for current market data (Glassdoor, Levels.fyi, Blind)
- Frame by role title, not by skills
- Contractor rates are typically 30-50% higher than employee base

## Your Negotiation Scripts

<!-- Adapt to YOUR situation, currency, location -->

**Salary expectations:**
> "Based on market data for this role, I'm targeting [RANGE from profile.yml]. I'm flexible on structure -- what matters is the total package and the opportunity."

**Geographic discount pushback:**
> "The roles I'm competitive for are output-based, not location-based. My track record doesn't change based on postal code."

**When offered below target:**
> "I'm comparing with opportunities in the [higher range]. I'm drawn to [company] because of [reason]. Can we explore [target]?"

## Your Location Policy — US ONLY

**Hard rule: US-based roles only.** Vikram is targeting positions in the United
States (remote-US, hybrid-US, or on-site US). Roles based outside the US
(UK/EU/Canada/India/APAC/LATAM/etc.) are **not a fit** — score the location
dimension **1.0** and recommend SKIP unless the posting explicitly offers a
US-based option.

**In forms:**
- Specify US work location / US time-zone overlap in free-text fields
- Follow actual availability from profile.yml

**In evaluations (scoring):**
- US remote / US hybrid / US on-site: score normally
- Non-US location with no US option: score location **1.0**, flag SKIP

## Visa Sponsorship — REQUIRED (MANDATORY CHECK)

**Vikram requires visa sponsorship to work in the US.** This is a hard
deal-breaker that MUST be checked on every evaluation.

**During evaluation (oferta / auto-pipeline / pipeline):**
1. Read the JD body for work-authorization language.
2. Classify into one of:
   - **Sponsors** — JD says "we sponsor", "visa sponsorship available",
     "H-1B/work-visa support", or is silent AND company is known to sponsor.
   - **No sponsorship** — JD says "must be authorized to work in the US
     without sponsorship", "no sponsorship", "US citizens/GC only",
     "must not require sponsorship now or in the future", or requires a
     security clearance.
   - **Unknown** — not stated, can't infer.
3. Apply to scoring + recommendation:
   - **No sponsorship → SKIP.** Do not generate a CV. Cap overall score at
     **2.0** and state the reason: "Excludes candidates needing sponsorship."
   - **Unknown → proceed but flag** in the report: "⚠️ Visa sponsorship not
     stated — confirm before applying."
   - **Sponsors → proceed normally**, note "✅ Sponsorship available."
4. Always surface the sponsorship status in the report header, e.g.
   `**Sponsorship:** No (SKIP) | Unknown (confirm) | Yes`.

**During apply mode:** if a form asks "Will you now or in the future require
sponsorship?" answer truthfully **Yes** (leave a [CONFIRM] note for Vikram).

> Note: the portal scanner cannot detect sponsorship from a job title — it only
> filters role + US location. Sponsorship is verified at evaluation time from
> the JD body, per the rules above.
