import { parse } from 'pgsql-ast-parser';

const sampleSql = `
  SELECT c.name, SUM(oi.quantity * oi.unit_price) AS total
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'completed'
  GROUP BY c.name
  LIMIT 10;
`;

console.log("=== Raw SQL ===");
console.log(sampleSql.trim());

try {
    const ast = parse(sampleSql);
    console.log("\n=== Parsed AST Structure ===");
    console.log(JSON.stringify(ast, null, 2));
} catch (err) {
    console.error("Parse Error:", err);
}
