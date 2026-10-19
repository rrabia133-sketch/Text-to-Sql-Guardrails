import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { Header } from "./components/Header";
import { UserSwitcherModal } from "./features/auth/UserSwitcherModal";

interface ApiHealthResponse {
    name: string;
    status: string;
    version: string;
}

function MainWorkspace() {
    const { user, loading } = useAuth();
    const [apiStatus, setApiStatus] = useState<ApiHealthResponse | null>(null);
    const [connecting, setConnecting] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [prompt, setPrompt] = useState(
        "Show total revenue per customer category for canceled orders in 2026"
    );

    useEffect(() => {
        fetch("/api/")
            .then((res) => {
                if (!res.ok) throw new Error("API response error");
                return res.json();
            })
            .then((data: ApiHealthResponse) => {
                setApiStatus(data);
                setConnecting(false);
            })
            .catch(() => {
                setConnecting(false);
            });
    }, []);

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner">Verifying session...</div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <Header />

            {user ? (
                /* Authenticated Workspace */
                <main className="workspace-main">
                    <section className="panel-card" id="prompt-section">
                        <div className="panel-header">
                            <h2 className="panel-title">Natural Language Request</h2>
                            <span className="brand-badge">Session: {user.username}</span>
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

                    <section className="panel-card" id="sql-preview-section">
                        <div className="panel-header">
                            <h2 className="panel-title">Validated SQL & AST Guardrails</h2>
                            <span
                                className="brand-badge"
                                style={{ borderColor: "#10b981", color: "#10b981" }}
                            >
                                AST Validated
                            </span>
                        </div>
                        <div className="panel-body">
                            <pre className="code-viewer">
                                <code>{`-- Target Database: analytics_db (read-only role: analytics_user)
-- Authenticated User: ${user.displayName} [${user.role}]
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
            ) : (
                /* Unauthenticated Empty State */
                <main className="unauth-workspace">
                    <div className="empty-state-card">
                        <div className="empty-state-icon">🔒</div>
                        <h2>Authentication Required</h2>
                        <p>Sign in to access your protected SQL query workspace and session history.</p>
                        <button
                            className="action-btn"
                            onClick={() => setIsModalOpen(true)}
                        >
                            Select Demo User to Sign In
                        </button>
                    </div>

                    <UserSwitcherModal
                        isOpen={isModalOpen}
                        onClose={() => setIsModalOpen(false)}
                    />
                </main>
            )}

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
                </div>

                <div className="status-group">
                    <div className="status-pill">
                        <span>Role:</span>
                        <span style={{ color: user ? "#10b981" : "#9ca3af" }}>
                            {user ? user.role.toUpperCase() : "GUEST"}
                        </span>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export function App() {
    return (
        <AuthProvider>
            <MainWorkspace />
        </AuthProvider>
    );
}

export default App;
