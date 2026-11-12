import { useState } from "react";
import { useAuth } from "./AuthContext";

interface AuthWelcomeScreenProps {
    onOpenModal: () => void;
}

export function AuthWelcomeScreen({ onOpenModal }: AuthWelcomeScreenProps) {
    const { availableUsers, login } = useAuth();
    const [submittingUser, setSubmittingUser] = useState<string | null>(null);
    const [loginError, setLoginError] = useState<string | null>(null);

    const handleQuickLogin = async (username: string) => {
        try {
            setLoginError(null);
            setSubmittingUser(username);
            await login(username);
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Failed to sign in. Ensure backend and app_db are running.";
            setLoginError(message);
        } finally {
            setSubmittingUser(null);
        }
    };

    return (
        <main className="unauth-workspace">
            <section className="auth-hero-shell" aria-label="Workspace Sign In">
                {/* Left Column: Guardrails & Execution Architecture Showcase */}
                <div className="auth-hero-showcase">
                    <div className="auth-eyebrow">
                        <span className="eyebrow-dot" aria-hidden="true"></span>
                        <span>Zero-Egress Security Sandbox</span>
                    </div>

                    <h2 className="auth-hero-title">
                        Ask in Plain English.
                        <br />
                        <span className="hero-accent-text">Execute Only Verified SQL.</span>
                    </h2>

                    <p className="auth-hero-subtitle">
                        High-assurance natural language analytics protected by deterministic AST validation,
                        semantic confidence scoring, and PostgreSQL read-only role containment.
                    </p>

                    <div className="auth-pillars-list">
                        <div className="auth-pillar-item">
                            <div className="pillar-icon-box" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                    <path d="m9 12 2 2 4-4" />
                                </svg>
                            </div>
                            <div className="pillar-copy">
                                <h3>AST Validation Gate</h3>
                                <p>Blocks multi-statements, DDL/DML writes, and system catalog inspection before dispatch.</p>
                            </div>
                        </div>

                        <div className="auth-pillar-item">
                            <div className="pillar-icon-box" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                                    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
                                </svg>
                            </div>
                            <div className="pillar-copy">
                                <h3>Read-Only Kernel Containment</h3>
                                <p>Isolated analytics pool runs inside explicit <code>READ ONLY</code> transactions with a 5s timeout.</p>
                            </div>
                        </div>

                        <div className="auth-pillar-item">
                            <div className="pillar-icon-box" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 20V10" />
                                    <path d="M18 20V4" />
                                    <path d="M6 20v-4" />
                                </svg>
                            </div>
                            <div className="pillar-copy">
                                <h3>Explainable Confidence &amp; Audit</h3>
                                <p>Transparent HIGH, REVIEW, and BLOCKED bands with immutable artifact hashes.</p>
                            </div>
                        </div>
                    </div>

                    <div className="auth-code-preview" aria-hidden="true">
                        <div className="auth-code-topbar">
                            <span className="auth-code-label">VERIFIED SQL PREVIEW</span>
                            <div className="auth-code-badges">
                                <span className="mini-pill-pass">AST PASSED</span>
                                <span className="mini-pill-score">96/100 HIGH</span>
                            </div>
                        </div>
                        <pre className="auth-code-snippet">
{`SELECT c.segment, ROUND(SUM(o.total_amount), 2) AS net_revenue
FROM orders o JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'completed' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;`}
                        </pre>
                    </div>
                </div>

                {/* Right Column: Interactive Quick Sign-In Panel */}
                <div className="auth-signin-panel">
                    <div className="auth-signin-header">
                        <div className="signin-shield-badge" aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="signin-title">Sign In to Workspace</h3>
                            <p className="signin-subtitle">
                                Select a seeded persona for instant one-click sandbox access.
                            </p>
                        </div>
                    </div>

                    {loginError && (
                        <div className="error-alert-banner" role="alert">
                            <span>⚠️ {loginError}</span>
                        </div>
                    )}

                    <div className="auth-persona-grid" role="list" aria-label="Demo User Personas">
                        {availableUsers.map((u) => {
                            const isLoading = submittingUser === u.username;
                            const isAdmin = u.role === "admin";

                            return (
                                <button
                                    key={u.id}
                                    type="button"
                                    className="auth-persona-card"
                                    onClick={() => void handleQuickLogin(u.username)}
                                    disabled={submittingUser !== null}
                                >
                                    <div className={`persona-svg-avatar ${isAdmin ? "avatar-admin" : "avatar-analyst"}`} aria-hidden="true">
                                        {isAdmin ? (
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                            </svg>
                                        ) : (
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                                <circle cx="12" cy="7" r="4" />
                                            </svg>
                                        )}
                                    </div>

                                    <div className="auth-persona-info">
                                        <div className="persona-name-row">
                                            <span className="persona-name">{u.displayName}</span>
                                            <span className={`role-pill role-${u.role}`}>{u.role}</span>
                                        </div>
                                        <span className="persona-desc">
                                            @{u.username} ·{" "}
                                            {isAdmin
                                                ? "Governance, retention & full audit logs"
                                                : "Read-only analytics & personal query history"}
                                        </span>
                                    </div>

                                    <span className="persona-arrow" aria-hidden="true">
                                        {isLoading ? <span className="btn-spinner-dark"></span> : "→"}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="auth-panel-footer">
                        <button
                            type="button"
                            className="auth-modal-trigger-link"
                            onClick={onOpenModal}
                        >
                            Open full persona switcher modal
                        </button>
                        <p className="auth-security-footnote">
                            HttpOnly cookie session · 15-minute artifact TTL · Zero raw PII in logs
                        </p>
                    </div>
                </div>
            </section>
        </main>
    );
}

