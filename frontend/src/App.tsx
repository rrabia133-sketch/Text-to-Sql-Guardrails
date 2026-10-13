import { useEffect, useState } from "react";
import type { HealthResponse } from "@text2sql/contracts";
interface ApiHealthResponse {
    name: string;
    status: string;
    version: string;
}

export function App() {
    const [apiStatus, setApiStatus] = useState<ApiHealthResponse | null>(null);
    const [connecting, setConnecting] = useState(true);
    const [prompt, setPrompt] = useState(
        "Show total revenue per customer category for canceled orders in 2026"
    );

    useEffect(() => {
        // Probes Fastify backend through Vite proxy (/api -> http://127.0.0.1:3001)
        fetch("/api/")
            .then((res) => {
                if (!res.ok) throw new Error("API response error");
                return res.json();
            })
            .then((data: ApiHealthResponse) => {
                setApiStatus(data);
                setConnecting(false);
            })
            .catch((err) => {
                console.error("Fastify API probe error:", err);
                setConnecting(false);
            });
    }, []);

    return (
        <div className="app-container">
            {/* 1. Header */}
            <header className="app-header">
                <div className="brand">
                    <div className="brand-icon">SQL</div>
                    <h1 className="brand-title">Text-to-SQL Guardrails</h1>
                    <span className="brand-badge">Sprint 2 Foundation</span>
                </div>

                <div className="header-meta">
                    <div className="user-badge" id="session-user-badge">
                        <span className="user-dot"></span>
                        <span>Analyst A (Session #1)</span>
                    </div>
                </div>
            </header>

            {/* 2. Workspace Container */}
            <main className="workspace-main">
                {/* Natural Language Prompt Panel */}
                <section className="panel-card" id="prompt-section">
                    <div className="panel-header">
                        <h2 className="panel-title">Natural Language Request</h2>
                        <span className="brand-badge">Grounded Context</span>
                    </div>
                    <div className="panel-body">
                        <textarea
                            id="prompt-input"
                            className="prompt-input"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Ask a question about analytical orders, customers, or revenue..."
                        />
                        <button
                            id="generate-sql-btn"
                            className="action-btn"
                            onClick={() => alert("Ready for Sprint 3 SQL generation pipeline!")}
                        >
                            Analyze & Generate SQL
                        </button>
                    </div>
                </section>

                {/* Guardrail & SQL Preview Panel */}
                <section className="panel-card" id="sql-preview-section">
                    <div className="panel-header">
                        <h2 className="panel-title">Validated SQL & AST Guardrails</h2>
                        <span className="brand-badge" style={{ borderColor: "#10b981", color: "#10b981" }}>
                            AST Validated
                        </span>
                    </div>
                    <div className="panel-body">
                        <pre className="code-viewer">
                            <code>{`-- Target Database: analytics_db (read-only role: analytics_user)
SELECT 
    c.category,
    COUNT(o.order_id) AS canceled_count,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS lost_revenue
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status = 'canceled'
  AND o.order_date >= '2026-01-01'
GROUP BY c.category
ORDER BY lost_revenue DESC;`}</code>
                        </pre>
                    </div>
                </section>
            </main>

            {/* 3. Status Bar */}
            <footer className="app-statusbar">
                <div className="status-group">
                    <div
                        id="backend-status-pill"
                        className={`status-pill ${apiStatus ? "online" : connecting ? "" : "offline"}`}
                    >
                        <span>●</span>
                        <span>
                            {connecting
                                ? "Connecting to API..."
                                : apiStatus
                                    ? `Fastify API: Connected (v${apiStatus.version})`
                                    : "Fastify API: Offline"}
                        </span>
                    </div>
                    <div className="status-pill">
                        <span>●</span>
                        <span>Loopback: 127.0.0.1:3001</span>
                    </div>
                </div>

                <div className="status-group">
                    <div className="status-pill">
                        <span>DB:</span>
                        <span style={{ color: "#38bdf8" }}>analytics_db :5434 [RO]</span>
                    </div>
                    <div className="status-pill">
                        <span>App:</span>
                        <span style={{ color: "#a855f7" }}>app_db :5434 [RW]</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export default App;
