import pg from 'pg';
const { Client } = pg;

// Connect strictly as the restricted analytics_user
const client = new Client({
    host: '127.0.0.1',
    port: 5434,
    user: 'analytics_user',
    password: 'analytics_read_only_2026',
    database: 'analytics_db',
});

async function runPermissionTests() {
    await client.connect();
    console.log("==================================================");
    console.log("   POSTGRESQL ROLE CONTAINMENT & PERMISSION TEST  ");
    console.log("   Connecting as: analytics_user                  ");
    console.log("==================================================\n");

    let passed = 0;
    let total = 0;

    // Test 1: Permitted SELECT
    total++;
    try {
        const res = await client.query('SELECT count(*) FROM customers;');
        console.log(`[PASS] 1. Permitted SELECT: Succeeded (${res.rows[0].count} customers)`);
        passed++;
    } catch (err: any) {
        console.error(`[FAIL] 1. Permitted SELECT failed:`, err.message);
    }

    // Test 2: Forbidden INSERT (Data modification)
    total++;
    try {
        await client.query("INSERT INTO customers (name, region) VALUES ('Hacker', 'EMEA');");
        console.error(`[LEAK] 2. Forbidden INSERT unexpectedly succeeded!`);
    } catch (err: any) {
        console.log(`[BLOCKED] 2. Forbidden INSERT: Correctly caught '${err.code}' (${err.message.trim()})`);
        passed++;
    }

    // Test 3: Forbidden DROP TABLE (DDL destruction)
    total++;
    try {
        await client.query("DROP TABLE orders;");
        console.error(`[LEAK] 3. Forbidden DROP TABLE unexpectedly succeeded!`);
    } catch (err: any) {
        console.log(`[BLOCKED] 3. Forbidden DROP TABLE: Correctly caught '${err.code}' (${err.message.trim()})`);
        passed++;
    }

    // Test 4: Forbidden CREATE TABLE (Schema change)
    total++;
    try {
        await client.query("CREATE TABLE backdoor (id int);");
        console.error(`[LEAK] 4. Forbidden CREATE TABLE unexpectedly succeeded!`);
    } catch (err: any) {
        console.log(`[BLOCKED] 4. Forbidden CREATE TABLE: Correctly caught '${err.code}' (${err.message.trim()})`);
        passed++;
    }

    // Test 5: Statement Timeout Protection (Denial of Service)
    total++;
    try {
        console.log("Testing 6-second sleep (should hit 5s statement_timeout)...");
        await client.query("SELECT pg_sleep(6);");
        console.error(`[LEAK] 5. Timeout protection failed!`);
    } catch (err: any) {
        console.log(`[BLOCKED] 5. Timeout Enforcement: Correctly terminated '${err.code}' (${err.message.trim()})`);
        passed++;
    }

    await client.end();

    console.log("\n==================================================");
    console.log(`Results: ${passed}/${total} Containment Checks Succeeded`);
    console.log("==================================================");

    if (passed === total) {
        console.log(">>> DATABASE ROLE CONTAINMENT INDEPENDENTLY PROVEN! <<<");
    } else {
        process.exit(1);
    }
}

runPermissionTests().catch(console.error);
