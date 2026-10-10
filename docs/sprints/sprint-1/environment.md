# Environment & Tooling Verification

- **Date Verified:** 2026-10-10
- **Operator:** Rehan Akbar

## 1. Tool Versions
- **Node.js:** v22.17.1
- **npm:** 11.6.2
- **Git:** 2.46.0.windows.1
- **Docker:** 29.8.2 (build 7fc2dff)
- **Docker Compose:** v5.5.1
- **Ollama:** 0.40.2

## 2. Hardware Constraints
- **CPU:** Intel(R) Core(TM) i9-14900HX (24 cores / 32 threads)
- **RAM:** 32 GB
- **GPU:** NVIDIA GeForce RTX 4060 Laptop GPU (8 GB VRAM)
- **OS:** Windows 11

## 3. Network & Port Allocation
- **Existing Containers:** Ports 5432 and 5433 are occupied by existing projects.
- **Assigned Loopback Port:** `127.0.0.1:5434:5432` for this project's fixture.

## 4. Policy & Budgets
- **Local Model Policy:** Local-first with Ollama (`qwen2.5-coder:7b`).
- **Cloud Policy:** Cloud testing (Groq) permitted for comparisons only with strict privacy (no customer rows or credentials transmitted).
- **Spending Cap:** Hard limit of $5.00 USD for cloud spike experiments.
