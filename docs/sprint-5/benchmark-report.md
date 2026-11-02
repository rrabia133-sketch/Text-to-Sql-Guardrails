# Sprint 5 — Semantic Evaluation & Confidence Calibration Report

- **Dataset ID:** `dev-eval-v1` (v1.0.0)
- **Model ID:** `qwen2.5-coder:7b`
- **Prompt Version:** `v1.0.0`
- **Total Evaluated Cases:** 52
- **Generated At:** 2026-11-02T09:02:51.003Z
- **Overall Gate Status:** PASS

---

## 1. Key NFR Quality Gates

| Metric | Empirical Value | Target Threshold | Status |
| :--- | :---: | :---: | :---: |
| **Overall Semantic Accuracy** | 90.4% | — | INFO |
| **High-Confidence Wrong-Answer Rate** | 0.0% | <= 5.0% | PASS |
| **Refusal / Clarification Recall** | 100.0% | >= 90.0% | PASS |
| **False Refusal Rate** | 8.8% | <= 15.0% | PASS |

---

## 2. Decision Band Breakdown

| Decision Band | Total Queries | Correct | Wrong | Empirical Accuracy |
| :--- | :---: | :---: | :---: | :---: |
| **HIGH** | 30 | 30 | 0 | 100.0% |
| **REVIEW** | 1 | 1 | 0 | 100.0% |
| **BLOCKED** | 21 | 16 | 5 | 76.2% |

---

## 3. Confidence Decile Reliability Binning (0–100)

| Confidence Decile Bin | Total Queries | Correct Queries | Empirical Accuracy |
| :--- | :---: | :---: | :---: |
| **0–9** | 15 | 13 | 86.7% |
| **10–19** | 0 | 0 | 0.0% |
| **20–29** | 0 | 0 | 0.0% |
| **30–39** | 2 | 2 | 100.0% |
| **40–49** | 2 | 1 | 50.0% |
| **50–59** | 0 | 0 | 0.0% |
| **60–69** | 1 | 1 | 100.0% |
| **70–79** | 0 | 0 | 0.0% |
| **80–89** | 32 | 30 | 93.8% |
| **90–100** | 0 | 0 | 0.0% |
