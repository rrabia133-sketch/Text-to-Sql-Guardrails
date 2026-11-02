import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BenchmarkRunner, type BenchmarkDataset } from "../../src/modules/evaluation/benchmark-runner.js";

describe("Sprint 5 - DO-07: Holdout Dataset Sequestration, Airgap Isolation & Calibration Gate", () => {
    const devDatasetPath = path.resolve(
        process.cwd(),
        fs.existsSync("backend/test/fixtures/evaluation/development-set.json")
            ? "backend/test/fixtures/evaluation/development-set.json"
            : "test/fixtures/evaluation/development-set.json"
    );

    const holdoutDatasetPath = path.resolve(
        process.cwd(),
        fs.existsSync("backend/test/fixtures/evaluation/holdout-set.json")
            ? "backend/test/fixtures/evaluation/holdout-set.json"
            : "test/fixtures/evaluation/holdout-set.json"
    );

    const runner = new BenchmarkRunner();

    it("verifies development corpus has 50+ cases and holdout corpus has 100+ sequestered cases with zero overlap", () => {
        const devSet = JSON.parse(fs.readFileSync(devDatasetPath, "utf-8")) as BenchmarkDataset;
        const holdoutSet = JSON.parse(fs.readFileSync(holdoutDatasetPath, "utf-8")) as BenchmarkDataset;

        assert.ok(devSet.cases.length >= 50, `Expected >= 50 dev cases, got ${devSet.cases.length}`);
        assert.equal(devSet.split, "development");

        assert.ok(
            holdoutSet.cases.length >= 100,
            `Expected >= 100 holdout cases, got ${holdoutSet.cases.length}`
        );
        assert.equal(holdoutSet.split, "holdout");
        assert.equal(holdoutSet.sequestered, true);

        const devIds = new Set(devSet.cases.map((c) => c.id));
        const devQuestions = new Set(devSet.cases.map((c) => c.question.toLowerCase()));

        for (const hCase of holdoutSet.cases) {
            assert.equal(
                devIds.has(hCase.id),
                false,
                `Holdout ID ${hCase.id} leaked into development dataset`
            );
            assert.equal(
                devQuestions.has(hCase.question.toLowerCase()),
                false,
                `Holdout question "${hCase.question}" leaked into development dataset`
            );
        }
    });

    it("blocks BenchmarkRunner from loading the holdout dataset unless RUN_HOLDOUT_EVAL=true", () => {
        assert.throws(
            () => runner.loadDataset(holdoutDatasetPath, { RUN_HOLDOUT_EVAL: "false" }),
            /HOLDOUT_ACCESS_DENIED/,
            "Holdout dataset must be blocked during standard development runs"
        );

        const allowed = runner.loadDataset(holdoutDatasetPath, { RUN_HOLDOUT_EVAL: "true" });
        assert.equal(allowed.split, "holdout");
        assert.ok(allowed.cases.length >= 100);
    });

    it("verifies zero leakage of holdout questions or IDs into prompt builder source files", () => {
        const promptFile = path.resolve(
            process.cwd(),
            fs.existsSync("backend/src/modules/generation/prompts/prompt-builder.ts")
                ? "backend/src/modules/generation/prompts/prompt-builder.ts"
                : "src/modules/generation/prompts/prompt-builder.ts"
        );
        const promptSource = fs.readFileSync(promptFile, "utf-8");
        assert.equal(
            promptSource.includes("HOLDOUT-"),
            false,
            "Prompt templates must never contain holdout case identifiers"
        );
        assert.equal(
            promptSource.includes("holdout-set.json"),
            false,
            "Prompt templates must never reference holdout-set.json"
        );
    });

    it("runs development benchmark evaluation and passes all Sprint 5 NFR calibration gates", async () => {
        const devDataset = runner.loadDataset(devDatasetPath);
        const { report } = await runner.runDataset(devDataset);

        assert.equal(report.decileBins.length, 10);
        assert.ok(report.highConfidenceWrongAnswerRate <= 0.05, "High-confidence wrong rate must be <= 5%");
        assert.ok(report.refusalClarificationRecall >= 0.90, "Refusal/clarification recall must be >= 90%");
        assert.ok(report.falseRefusalRate <= 0.15, "False refusal rate must be <= 15%");
        assert.equal(report.targetsMet.allPassed, true);
    });
});

