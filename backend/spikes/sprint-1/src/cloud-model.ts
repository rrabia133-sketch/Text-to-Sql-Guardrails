export interface CloudGenerationResult {
    sql: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    provider: string;
}

// Hard Spending Cap ($5.00 USD)
const SPENDING_CAP_USD = 5.00;
let cumulativeSpendUsd = 0.00;

// Pricing for Groq llama-3.1-8b-instant ($0.05 / 1M prompt tokens, $0.08 / 1M completion tokens)
const COST_PER_1M_INPUT = 0.05;
const COST_PER_1M_OUTPUT = 0.08;

const SYSTEM_PROMPT = `
You are a secure Text-to-SQL analytics translator for PostgreSQL 16.
Convert the user's question into a single, valid PostgreSQL SELECT statement.

Schema:
- customers (id INT PK, name VARCHAR, region VARCHAR, created_at TIMESTAMPTZ)
- products (id INT PK, name VARCHAR, category VARCHAR, unit_price NUMERIC)
- orders (id INT PK, customer_id INT FK, status VARCHAR, ordered_at TIMESTAMPTZ)
- order_items (id INT PK, order_id INT FK, product_id INT FK, quantity INT, unit_price NUMERIC)

Glossary:
- Revenue = SUM(order_items.quantity * order_items.unit_price) where status IN ('completed', 'shipped').
- Standard limit: Include LIMIT 50 if no limit is requested.

STRICT RULES:
1. Output ONLY the raw SQL query. No explanations, no markdown backticks, no comments.
2. Single SELECT statements only. Never generate INSERT, UPDATE, DELETE, or DROP.
`;

export async function callGroqCloud(
    question: string,
    apiKey: string | undefined = process.env.GROQ_API_KEY
): Promise<CloudGenerationResult> {
    // Check Spending Cap
    if (cumulativeSpendUsd >= SPENDING_CAP_USD) {
        throw new Error(`Cloud spending cap of $${SPENDING_CAP_USD} reached. Halting cloud requests.`);
    }

    // If no API key is provided, simulate benchmark based on official Groq LPUs
    if (!apiKey) {
        const simLatency = Math.floor(Math.random() * 200) + 250; // 250-450ms
        const simInputTokens = 240;
        const simOutputTokens = 35;
        const simCost = (simInputTokens / 1_000_000) * COST_PER_1M_INPUT + (simOutputTokens / 1_000_000) * COST_PER_1M_OUTPUT;
        cumulativeSpendUsd += simCost;

        return {
            sql: "SELECT id, name FROM customers WHERE region = 'EMEA' LIMIT 50;",
            latencyMs: simLatency,
            inputTokens: simInputTokens,
            outputTokens: simOutputTokens,
            estimatedCostUsd: simCost,
            provider: "Groq (simulated benchmark)"
        };
    }

    const startTime = Date.now();
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: question }
            ],
            temperature: 0.1,
            max_tokens: 250
        })
    });

    if (!res.ok) {
        throw new Error(`Groq API Error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const latency = Date.now() - startTime;
    let sql = data.choices[0]?.message?.content?.trim() || '';
    sql = sql.replace(/```sql/gi, '').replace(/```/g, '').trim();

    const inTokens = data.usage?.prompt_tokens || 0;
    const outTokens = data.usage?.completion_tokens || 0;
    const callCost = (inTokens / 1_000_000) * COST_PER_1M_INPUT + (outTokens / 1_000_000) * COST_PER_1M_OUTPUT;
    cumulativeSpendUsd += callCost;

    return {
        sql,
        latencyMs: latency,
        inputTokens: inTokens,
        outputTokens: outTokens,
        estimatedCostUsd: callCost,
        provider: 'Groq (llama-3.1-8b-instant)'
    };
}
