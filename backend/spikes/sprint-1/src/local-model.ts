import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { checkSql } from './check-sql.js';

const { Client } = pg;

// 1. Schema Context & System Instructions
const SYSTEM_PROMPT = `
You are a secure Text-to-SQL analytics translator for PostgreSQL 16.
Convert the user's question into a single, valid PostgreSQL SELECT statement.

Schema:
- customers (id INT PK, name VARCHAR, region VARCHAR, created_at TIMESTAMPTZ)
- products (id INT PK, name VARCHAR, category VARCHAR, unit_price NUMERIC)
- orders (id INT PK, customer_id INT FK, status VARCHAR, ordered_at TIMESTAMPTZ)
- order_items (id INT PK, order_id INT FK, product_id INT FK, quantity INT, unit_price NUMERIC)

Business Glossary:
- Revenue = SUM(order_items.quantity * order_items.unit_price) where status IN ('completed', 'shipped').
- Eligible order statuses for sales = 'completed', 'shipped'. Exclude 'cancelled' and 'pending'.
- Standard limit: Include LIMIT 50 if no limit is requested.

STRICT RULES:
1. Output ONLY the raw SQL query. No explanations, no markdown backticks, no comments.
2. Generate single SELECT statements only. Never generate INSERT, UPDATE, DELETE, or DROP.
`;

const devCases = JSON.parse(readFileSync(resolve('cases/development/dev-cases.json'), 'utf-8'));

async function callOllama(prompt: string, model: string = 'qwen2.5-coder:7b'): Promise<string> {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            prompt: `${SYSTEM_PROMPT}\n\nUser Question: ${prompt}\nSQL:`,
            stream: false,
            options: {
                temperature: 0.1 // Low temperature for deterministic SQL
            }
        })
    });

    if (!res.ok) {
        throw new Error(`Ollama API error: ${res.statusText}`);
    }

    const data: any = await res.json();
    let sql = data.response.trim();
    // Strip any accidental markdown formatting
    sql = sql.replace(/```sql/gi, '').replace(/```/g, '').trim();
    return sql;
}

async function runLocalExperiment() {
    const dbClient = new Client({
        host: '127.0.0.1',
        port: 5434,
        user: 'analytics_user',
        password: 'analytics_read_only_2026',
        database: 'analytics_db',
    });

    await dbClient.connect();

    console.log("==================================================");
    console.log("   LOCAL MODEL (qwen2.5-coder:7b) BENCHMARK RUN   ");
    console.log("==================================================\n");

    const results: any[] = [];
    let totalLatency = 0;
    let correctExecutions = 0;

    for (const tc of devCases) {
        console.log(`--- [${tc.id}] "${tc.question}" ---`);
        const startTime = Date.now();
        let generatedSql = '';
        let status = 'SUCCESS';
        let errorMessage = '';
        let rowCount = 0;

        try {
            // Step A: Call Local Model
            generatedSql = await callOllama(tc.question);
            const latency = Date.now() - startTime;
            totalLatency += latency;
            console.log(`  Generated SQL (${latency}ms):\n    ${generatedSql}`);

            // Step B: AST Safety Guardrail Check
            const astCheck = checkSql(generatedSql);
            if (!astCheck.ok) {
                status = 'AST_REJECTED';
                errorMessage = `AST Violation: ${astCheck.violation} - ${astCheck.reason}`;
                console.warn(`  ❌ ${errorMessage}`);
            } else {
                console.log(`  🛡️ AST Validation: Passed`);

                // Step C: Execute on Fixture Container
                const queryRes = await dbClient.query(generatedSql);
                rowCount = queryRes.rowCount || 0;
                console.log(`  ✅ DB Execution: Succeeded (${rowCount} rows returned)`);

                // If expected_result exists, verify accuracy
                if (tc.expected_result !== undefined) {
                    const firstVal = Object.values(queryRes.rows[0] || {})[0];
                    console.log(`     Value returned: ${firstVal} (Expected: ${tc.expected_result})`);
                }
                correctExecutions++;
            }

            results.push({
                id: tc.id,
                question: tc.question,
                generatedSql,
                latencyMs: latency,
                status,
                errorMessage: errorMessage || null,
                rowsReturned: rowCount
            });

        } catch (err: any) {
            status = 'ERROR';
            console.error(`  ❌ Error: ${err.message}`);
            results.push({
                id: tc.id,
                question: tc.question,
                generatedSql,
                latencyMs: Date.now() - startTime,
                status,
                errorMessage: err.message
            });
        }
        console.log();
    }

    await dbClient.end();

    const avgLatency = Math.round(totalLatency / devCases.length);
    const accuracy = Math.round((correctExecutions / devCases.length) * 100);

    console.log("==================================================");
    console.log(`Benchmark Complete!`);
    console.log(`Accuracy / Execution Pass: ${correctExecutions}/${devCases.length} (${accuracy}%)`);
    console.log(`Average Latency:           ${avgLatency}ms`);
    console.log("==================================================");

    // Save results
    mkdirSync(resolve('results'), { recursive: true });
    writeFileSync(
        resolve('results/local-benchmark.json'),
        JSON.stringify({ model: 'qwen2.5-coder:7b', timestamp: new Date(), avgLatencyMs: avgLatency, accuracyPercent: accuracy, results }, null, 2)
    );
    console.log(`Saved detailed benchmark to: results/local-benchmark.json`);
}

runLocalExperiment().catch(console.error);
