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
