# ADR 04: LLM Provider & Privacy Strategy

- **Status:** Accepted
- **Deciders:** Rabia-Dev
- **Date:** 2026-10-10

## Context & Problem
We require accurate Text-to-SQL generation while respecting user data privacy and cost budgets.

## Decision
1. **Default Local Engine:** **Ollama with `qwen2.5-coder:7b`** is the default for local development ($0 cost, 100% offline, zero data transmission).
2. **Cloud Acceleration Option:** **Groq (`llama-3.1-8b-instant`)** is supported as an optional cloud engine for ultra-low latency (<350ms) on low-spec hardware.
3. **Hard Privacy Boundary:** Prompts contain only table/column names and business definitions. **Database rows and credentials are never transmitted.**
4. **Spending Cap:** Hard limit of **$5.00 USD** on cloud API usage.

## Empirical Findings (Spike Benchmark)
Based on benchmarks recorded in [`provider-comparison.md`](../provider-comparison.md):
- **Accuracy:** Both Ollama (`qwen2.5-coder:7b`) and Groq (`llama-3.1-8b-instant`) achieved 100% valid query generation on the development test suite.
- **Latency:** Groq averaged ~320ms warm latency (instant cold start); Ollama averaged ~633ms warm latency (~54s cold start for initial model loading into VRAM).
- **Cost:** Ollama incurred $0.00; Groq incurred ~$0.0001 per query (~$0.02 to $0.05 per 1,000 queries), well within the $5.00 spend cap.

## Trade-offs & Consequences
- **Local Ollama:**
  - *Pros:* 100% offline, zero egress risk, zero marginal operating cost, unlimited local experimentation.
  - *Cons:* Requires minimum 6GB VRAM or 16GB RAM; cold-start weight loading time.
- **Cloud Groq:**
  - *Pros:* Extremely fast (<350ms), zero client GPU requirement, instant execution on low-spec machines.
  - *Cons:* Requires internet connectivity and Groq API key; schema structure egress to third-party cloud.

## Conditions for Reconsideration
- If local execution hardware is insufficient for acceptable user responsiveness, enable cloud Groq as the default accelerator.
- If corporate data governance prohibits schema transmission to cloud providers, completely disable Groq and restrict application runtime to offline Ollama.
- If cloud spending approaches the $5.00 budget limit, automatic circuit breakers trip, falling back strictly to local Ollama.
