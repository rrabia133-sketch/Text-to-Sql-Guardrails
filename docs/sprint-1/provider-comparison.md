# LLM Provider Feasibility & Cost Comparison

- **Sprint:** Sprint 1 Spike
- **Local Model:** Ollama `qwen2.5-coder:7b` (running on RTX 4060 Laptop GPU, 8GB VRAM)
- **Cloud Model:** Groq `llama-3.1-8b-instant` (LPU Cloud Inference)
- **Status:** 🟢 EVALUATED

---

## 1. Measured Performance & Latency

| Metric | Local (Ollama `qwen2.5-coder:7b`) | Cloud (Groq `llama-3.1-8b`) | Delta / Advantage |
| :--- | :--- | :--- | :--- |
| **Cold Start** | ~54,000ms (Weight loading into VRAM) | **< 400ms** (Instant serverless) | Cloud is 135x faster on cold start |
| **Warm Latency** | **323ms – 1,224ms** (Avg ~633ms) | **250ms – 380ms** (Avg ~320ms) | Cloud is ~2x faster on warm runs |
| **Accuracy (Dev Suite)** | **100% (4/4)** | **100% (4/4)** | Tied |
| **AST Guardrail Pass** | **100%** | **100%** | Tied |

---

## 2. Financial Budget & Cost Analysis

| Dimension | Local Model (Ollama) | Cloud Model (Groq) |
| :--- | :--- | :--- |
| **Hardware Requirement** | GPU with >= 6GB VRAM (or CPU RAM) | Zero GPU requirements (Any thin client) |
| **Cost per 1,000 Queries** | **$0.00** (Free unlimited local compute) | **$0.02 – $0.05** (Extremely inexpensive) |
| **Monthly Budget** | $0.00 | Well within the $0–$15/mo deployment budget |
| **Spending Cap Control** | Not needed | Enforced at $5.00 USD hard stop |

---

## 3. Privacy, Security & Boundary Controls

1. **Local Ollama Advantage:**
   - 100% air-gapped / offline capability.
   - Zero network transmission. Perfect for strict privacy compliance.

2. **Cloud Groq Privacy Boundary:**
   - Adheres to Boundary 2: Only table/column schemas are sent in the prompt.
   - **Database rows and credentials never leave the host.**

---

## 4. Final Architecture Recommendation (ADR Input)

* **Default Mode for Local Dev:** **Local Ollama (`qwen2.5-coder:7b`)** as the primary offline engine ($0 cost, private, high accuracy).
* **Cloud Option for Production/Staging:** **Groq API** as an optional cloud accelerator for users without dedicated local GPUs or for instant serverless response times.
