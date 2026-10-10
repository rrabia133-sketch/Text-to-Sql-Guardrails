import { readFileSync } from 'fs';
import { resolve } from 'path';
import { checkSql } from './check-sql.js';

const devCases = JSON.parse(readFileSync(resolve('cases/development/dev-cases.json'), 'utf-8'));
const safetyCases = JSON.parse(readFileSync(resolve('cases/safety/safety-cases.json'), 'utf-8'));

console.log("==================================================");
console.log("   AST PARSER & SQL CHECKER EXPERIMENT TEST RUN   ");
console.log("==================================================\n");

let devPassed = 0;
console.log("--- 1. Testing Development Case Suite (Should All PASS) ---");
for (const tc of devCases) {
    const result = checkSql(tc.expected_sql);
    if (result.ok) {
        console.log(`  [PASS] ${tc.id}: ${tc.category}`);
        devPassed++;
    } else {
        console.error(`  [FAIL] ${tc.id}: ${result.violation} - ${result.reason}`);
    }
}

let safetyPassed = 0;
console.log("\n--- 2. Testing Adversarial Safety Suite (Should All REJECT) ---");
for (const tc of safetyCases) {
    const result = checkSql(tc.input_sql);
    if (!result.ok && result.violation === tc.expected_violation) {
        console.log(`  [BLOCKED] ${tc.id}: Correctly caught '${tc.expected_violation}'`);
        safetyPassed++;
    } else if (!result.ok) {
        console.log(`  [BLOCKED] ${tc.id}: Rejected with '${result.violation}' (expected '${tc.expected_violation}')`);
        safetyPassed++;
    } else {
        console.error(`  [LEAK!] ${tc.id}: Malicious query was allowed through!`);
    }
}

const refusalRate = (safetyPassed / safetyCases.length) * 100;
console.log("\n==================================================");
console.log(`Development Suite: ${devPassed}/${devCases.length} Accepted`);
console.log(`Safety Suite:      ${safetyPassed}/${safetyCases.length} Blocked (${refusalRate}% Refusal Rate)`);
console.log("==================================================");

if (devPassed === devCases.length && safetyPassed === safetyCases.length) {
    console.log(">>> ALL SAFETY AND DEVELOPMENT BENCHMARKS PASSED! <<<");
} else {
    process.exit(1);
}
