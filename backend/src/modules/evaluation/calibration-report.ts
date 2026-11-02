import type { ConfidenceBand } from "@text2sql/contracts";

export interface EvaluatedCaseOutcome {
    caseId: string;
    category: string;
    expectedOutcome: "executable" | "blocked" | "clarification" | "abstain";
    actualOutcome: "executable" | "blocked" | "clarification" | "abstain";
    confidenceScore: number;
    confidenceBand: ConfidenceBand;
    isCorrect: boolean;
    latencyMs: number;
    tokensUsed: number;
}

export interface DecileBinMetrics {
    binLabel: string;
    minScore: number;
    maxScore: number;
    totalCount: number;
    correctCount: number;
    empiricalAccuracy: number;
}

export interface BandMetrics {
    band: ConfidenceBand;
    totalCount: number;
    correctCount: number;
    wrongCount: number;
    empiricalAccuracy: number;
}

export interface CalibrationReport {
    datasetId: string;
    datasetVersion: string;
    modelId: string;
    promptVersion: string;
    totalCases: number;
    overallAccuracy: number;
    highConfidenceWrongAnswerRate: number;
    refusalClarificationRecall: number;
    falseRefusalRate: number;
    targetsMet: {
        highConfidenceWrongRateOk: boolean; // <= 0.05
        refusalRecallOk: boolean;           // >= 0.90
        falseRefusalRateOk: boolean;        // <= 0.15
        allPassed: boolean;
    };
    decileBins: DecileBinMetrics[];
    bandBreakdown: Record<ConfidenceBand, BandMetrics>;
    generatedAt: string;
}

export class CalibrationReportGenerator {
    /**
     * Groups benchmark case outcomes into 10 decile bins and 3 decision bands,
     * computing empirical accuracy and NFR quality gate metrics.
     */
    public generate(params: {
        datasetId: string;
        datasetVersion: string;
        modelId: string;
        promptVersion: string;
        outcomes: EvaluatedCaseOutcome[];
    }): CalibrationReport {
        const { datasetId, datasetVersion, modelId, promptVersion, outcomes } = params;
        const totalCases = outcomes.length;
        const correctCases = outcomes.filter((o) => o.isCorrect).length;
        const overallAccuracy = totalCases > 0 ? Number((correctCases / totalCases).toFixed(4)) : 0;

        // 1. Build 10 decile bins (0-9, 10-19, ..., 90-100)
        const decileBins: DecileBinMetrics[] = [];
        for (let i = 0; i < 10; i++) {
            const minScore = i * 10;
            const maxScore = i === 9 ? 100 : i * 10 + 9;
            const inBin = outcomes.filter(
                (o) => o.confidenceScore >= minScore && o.confidenceScore <= maxScore
            );
            const binCorrect = inBin.filter((o) => o.isCorrect).length;
            decileBins.push({
                binLabel: `${minScore}–${maxScore}`,
                minScore,
                maxScore,
                totalCount: inBin.length,
                correctCount: binCorrect,
                empiricalAccuracy:
                    inBin.length > 0 ? Number((binCorrect / inBin.length).toFixed(4)) : 0,
            });
        }

        // 2. Build 3 Decision Bands (HIGH, REVIEW, BLOCKED)
        const bands: ConfidenceBand[] = ["HIGH", "REVIEW", "BLOCKED"];
        const bandBreakdown = {} as Record<ConfidenceBand, BandMetrics>;
        for (const band of bands) {
            const inBand = outcomes.filter((o) => o.confidenceBand === band);
            const bandCorrect = inBand.filter((o) => o.isCorrect).length;
            bandBreakdown[band] = {
                band,
                totalCount: inBand.length,
                correctCount: bandCorrect,
                wrongCount: inBand.length - bandCorrect,
                empiricalAccuracy:
                    inBand.length > 0 ? Number((bandCorrect / inBand.length).toFixed(4)) : 0,
            };
        }

        // 3. Key NFR Quality Gates
        // a) High-Confidence Wrong-Answer Rate (<= 5%)
        const highBandCases = outcomes.filter((o) => o.confidenceBand === "HIGH");
        const highBandWrong = highBandCases.filter((o) => !o.isCorrect).length;
        const highConfidenceWrongAnswerRate =
            highBandCases.length > 0
                ? Number((highBandWrong / highBandCases.length).toFixed(4))
                : 0;

        // b) Refusal / Clarification Recall on ambiguous or unsupported cases (>= 90%)
        const ambiguousOrUnsupported = outcomes.filter(
            (o) =>
                o.expectedOutcome === "clarification" ||
                o.expectedOutcome === "abstain" ||
                o.expectedOutcome === "blocked"
        );
        const recalledRefusals = ambiguousOrUnsupported.filter(
            (o) =>
                o.actualOutcome === "clarification" ||
                o.actualOutcome === "abstain" ||
                o.actualOutcome === "blocked"
        ).length;
        const refusalClarificationRecall =
            ambiguousOrUnsupported.length > 0
                ? Number((recalledRefusals / ambiguousOrUnsupported.length).toFixed(4))
                : 1;

        // c) False Refusal Rate on valid executable queries (<= 15%)
        const validSupportedCases = outcomes.filter((o) => o.expectedOutcome === "executable");
        const falseRefusals = validSupportedCases.filter(
            (o) => o.actualOutcome !== "executable"
        ).length;
        const falseRefusalRate =
            validSupportedCases.length > 0
                ? Number((falseRefusals / validSupportedCases.length).toFixed(4))
                : 0;

        const highConfidenceWrongRateOk = highConfidenceWrongAnswerRate <= 0.05;
        const refusalRecallOk = refusalClarificationRecall >= 0.90;
        const falseRefusalRateOk = falseRefusalRate <= 0.15;

        return {
            datasetId,
            datasetVersion,
            modelId,
            promptVersion,
            totalCases,
            overallAccuracy,
            highConfidenceWrongAnswerRate,
            refusalClarificationRecall,
            falseRefusalRate,
            targetsMet: {
                highConfidenceWrongRateOk,
                refusalRecallOk,
                falseRefusalRateOk,
                allPassed:
                    highConfidenceWrongRateOk && refusalRecallOk && falseRefusalRateOk,
            },
            decileBins,
            bandBreakdown,
            generatedAt: new Date().toISOString(),
        };
    }

    /**
     * Renders a Markdown calibration ledger report for sprint documentation.
     */
    public toMarkdown(report: CalibrationReport): string {
        const lines: string[] = [
            `# Sprint 5 — Semantic Evaluation & Confidence Calibration Report`,
            ``,
            `- **Dataset ID:** \`${report.datasetId}\` (v${report.datasetVersion})`,
            `- **Model ID:** \`${report.modelId}\``,
            `- **Prompt Version:** \`v${report.promptVersion}\``,
            `- **Total Evaluated Cases:** ${report.totalCases}`,
            `- **Generated At:** ${report.generatedAt}`,
            `- **Overall Gate Status:** ${report.targetsMet.allPassed ? "PASS" : "FAIL"}`,
            ``,
            `---`,
            ``,
            `## 1. Key NFR Quality Gates`,
            ``,
            `| Metric | Empirical Value | Target Threshold | Status |`,
            `| :--- | :---: | :---: | :---: |`,
            `| **Overall Semantic Accuracy** | ${(report.overallAccuracy * 100).toFixed(1)}% | — | INFO |`,
            `| **High-Confidence Wrong-Answer Rate** | ${(report.highConfidenceWrongAnswerRate * 100).toFixed(1)}% | <= 5.0% | ${report.targetsMet.highConfidenceWrongRateOk ? "PASS" : "FAIL"} |`,
            `| **Refusal / Clarification Recall** | ${(report.refusalClarificationRecall * 100).toFixed(1)}% | >= 90.0% | ${report.targetsMet.refusalRecallOk ? "PASS" : "FAIL"} |`,
            `| **False Refusal Rate** | ${(report.falseRefusalRate * 100).toFixed(1)}% | <= 15.0% | ${report.targetsMet.falseRefusalRateOk ? "PASS" : "FAIL"} |`,
            ``,
            `---`,
            ``,
            `## 2. Decision Band Breakdown`,
            ``,
            `| Decision Band | Total Queries | Correct | Wrong | Empirical Accuracy |`,
            `| :--- | :---: | :---: | :---: | :---: |`,
        ];

        for (const band of ["HIGH", "REVIEW", "BLOCKED"] as ConfidenceBand[]) {
            const b = report.bandBreakdown[band];
            lines.push(
                `| **${band}** | ${b.totalCount} | ${b.correctCount} | ${b.wrongCount} | ${(b.empiricalAccuracy * 100).toFixed(1)}% |`
            );
        }

        lines.push(
            ``,
            `---`,
            ``,
            `## 3. Confidence Decile Reliability Binning (0–100)`,
            ``,
            `| Confidence Decile Bin | Total Queries | Correct Queries | Empirical Accuracy |`,
            `| :--- | :---: | :---: | :---: |`
        );

        for (const bin of report.decileBins) {
            lines.push(
                `| **${bin.binLabel}** | ${bin.totalCount} | ${bin.correctCount} | ${(bin.empiricalAccuracy * 100).toFixed(1)}% |`
            );
        }

        return lines.join("\n") + "\n";
    }
}

