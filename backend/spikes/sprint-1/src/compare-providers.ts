import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { checkSql } from './check-sql.js';
import { callGroqCloud } from './cloud-model.js';

const devCases = JSON.parse(readFileSync(resolve('cases/development/dev-cases.json'), 'utf-8'));
const localBench = JSON.parse(readFileSync(resolve('results/local-benchmark.json'), 'utf-8'));

async function compareProviders() {
    console.log("==================================================");
    console.log("   LOCAL (OLLAMA) vs CLOUD (GROQ) COMPARISON      ");
    console.log("==================================================\n");

    const comparisonData: any[] = [];
    let totalCloudLatency = 0;
    let totalCloudCost = 0;

    for (let i = 0; i < devCases.length; i++) {
        const tc = devCases[i];
        const localResult = localBench.results[i];

        console.log(`--- [${tc.id}] "${tc.question}" ---`);
        console.log(`  Local (Ollama 7B):   ${localResult.latencyMs}ms | Status: ${localResult.status}`);

        const cloudResult = await callGroqCloud(tc.question);
        const cloudAst = checkSql(cloudResult.sql);

        console.log(`  Cloud (${cloudResult.provider}): ${cloudResult.latencyMs}ms | Cost: $${cloudResult.estimatedCostUsd.toFixed(6)} | AST: ${cloudAst.ok ? 'Passed' : 'Failed'}`);

        totalCloudLatency += cloudResult.latencyMs;
        totalCloudCost += cloudResult.estimatedCostUsd;

        comparisonData.push({
            id: tc.id,
            question: tc.question,
            local: {
                model: 'qwen2.5-coder:7b',
                latencyMs: localResult.latencyMs,
                status: localResult.status,
                costUsd: 0.00
            },
            cloud: {
                provider: cloudResult.provider,
                latencyMs: cloudResult.latencyMs,
                costUsd: cloudResult.estimatedCostUsd,
                astPassed: cloudAst.ok
            }
        });
        console.log();
    }

    const avgCloudLatency = Math.round(totalCloudLatency / devCases.length);

    console.log("==================================================");
    console.log("               COMPARISON SUMMARY                 ");
    console.log("==================================================");
    console.log(`Local (Ollama 7B)  Avg Warm Latency: ~633ms  | Cost: $0.00`);
    console.log(`Cloud (Groq LPU)   Avg Latency:      ${avgCloudLatency}ms  | Cost: $${totalCloudCost.toFixed(6)}`);
    console.log("==================================================");

    mkdirSync(resolve('results'), { recursive: true });
    writeFileSync(
        resolve('results/provider-comparison.json'),
        JSON.stringify({ timestamp: new Date(), comparisonData, totalCloudCostUsd: totalCloudCost }, null, 2)
    );
    console.log("Saved comparative report to: results/provider-comparison.json");
}

compareProviders().catch(console.error);
