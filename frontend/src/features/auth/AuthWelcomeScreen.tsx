import { useState } from "react";
import { AlertTriangle, ArrowRight, Lock, UserCheck } from "lucide-react";
import { useAuth } from "./AuthContext";

interface AuthWelcomeScreenProps {
    onOpenModal?: () => void;
}

export function AuthWelcomeScreen({ onOpenModal: _onOpenModal }: AuthWelcomeScreenProps) {
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

    // Keep only Administrator, removing Analyst Alice and Analyst Bob as requested
    const adminUsers = availableUsers.filter(
        (u) => u.role === "admin" || u.username === "admin_user"
    );
    const usersToRender =
        adminUsers.length > 0
            ? adminUsers
            : [
                  {
                      id: "usr_admin_01",
                      username: "admin_user",
                      role: "admin",
                      displayName: "System Administrator",
                  },
              ];

    return (
        <main className="unauth-workspace">
            <section className="auth-hero-shell" aria-label="Workspace Sign In">
                {/* Left Column: Natural Language Analytics Showcase */}
                <div className="auth-hero-showcase">
                    <h2 className="auth-hero-title">
                        Ask in Plain English.
                        <br />
                        <span className="hero-accent-text">Execute Only Verified SQL.</span>
                    </h2>

                    <p className="auth-hero-subtitle">
                        High-assurance natural language analytics protected by deterministic AST validation,
                        semantic confidence scoring, and PostgreSQL read-only role containment.
                    </p>
                </div>

                {/* Right Column: Interactive Quick Sign-In Panel */}
                <div className="auth-signin-panel">
                    <div className="auth-signin-header">
                        <div className="signin-shield-badge" aria-hidden="true">
                            <Lock size={18} />
                        </div>
                        <div>
                            <h3 className="signin-title">Sign In to Workspace</h3>
                            <p className="signin-subtitle">
                                Select administrator persona for instant one-click sandbox access.
                            </p>
                        </div>
                    </div>

                    {loginError && (
                        <div className="error-alert-banner" role="alert">
                            <AlertTriangle size={15} />
                            <span>{loginError}</span>
                        </div>
                    )}

                    <div className="auth-persona-grid" role="list" aria-label="Admin Personas">
                        {usersToRender.map((u) => {
                            const isLoading = submittingUser === u.username;

                            return (
                                <button
                                    key={u.id}
                                    type="button"
                                    className="auth-persona-card"
                                    onClick={() => void handleQuickLogin(u.username)}
                                    disabled={submittingUser !== null}
                                >
                                    <div className="persona-svg-avatar avatar-admin" aria-hidden="true">
                                        <UserCheck size={18} />
                                    </div>

                                    <div className="auth-persona-info">
                                        <div className="persona-name-row">
                                            <span className="persona-name">{u.displayName}</span>
                                            <span className={`role-pill role-${u.role}`}>{u.role}</span>
                                        </div>
                                        <span className="persona-desc">
                                            @{u.username} · Governance, retention &amp; full audit logs
                                        </span>
                                    </div>

                                    <span className="persona-arrow" aria-hidden="true">
                                        {isLoading ? <span className="btn-spinner-dark"></span> : <ArrowRight size={16} />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>
        </main>
    );
}

