import path from "node:path";
import fs from "node:fs";
import { BenchmarkRunner } from "../src/modules/evaluation/benchmark-runner.js";
import { CalibrationReportGenerator } from "../src/modules/evaluation/calibration-report.js";

async function main() {
    const args = process.argv.slice(2);
    const datasetArg =
        args.find((a) => a.startsWith("--dataset="))?.split("=")[1] ??
        path.resolve(process.cwd(), "backend/test/fixtures/evaluation/development-set.json");
    const modelId =
        args.find((a) => a.startsWith("--model="))?.split("=")[1] ?? "qwen2.5-coder:7b";
    const outArg = args.find((a) => a.startsWith("--out="))?.split("=")[1];

    const runner = new BenchmarkRunner();
    const dataset = runner.loadDataset(datasetArg);
    const { report } = await runner.runDataset(dataset, { modelId });

    const generator = new CalibrationReportGenerator();
    const markdown = generator.toMarkdown(report);

    if (outArg) {
        fs.writeFileSync(outArg, markdown, "utf-8");
    }

    console.log(markdown);
    if (!report.targetsMet.allPassed) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error("[evaluate-semantic] Fatal error:", err.message);
    process.exit(1);
});

