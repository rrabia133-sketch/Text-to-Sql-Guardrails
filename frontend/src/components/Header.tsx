import { useState } from "react";
import { useAuth } from "../features/auth/AuthContext";
import { UserSwitcherModal } from "../features/auth/UserSwitcherModal";

export interface HeaderProps {
    onOpenHistory?: () => void;
}

export function Header({ onOpenHistory }: HeaderProps = {}) {
    const { user, logout } = useAuth();
    const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

    return (
        <>
            <header className="app-header">
                <div className="brand">
                    <div className="brand-icon">SQL</div>
                    <h1 className="brand-title">Text-to-SQL Guardrails</h1>
                    <span className="brand-badge">Sprint 6</span>
                </div>

                <div className="header-meta">
                    {user ? (
                        <>
                            {onOpenHistory && (
                                <button
                                    type="button"
                                    className="btn-history-toggle"
                                    id="history-toggle-btn"
                                    onClick={onOpenHistory}
                                    title="Open Query History"
                                    aria-label="Open Query History"
                                >
                                    📜 History
                                </button>
                            )}

                            <button
                                className="user-badge-btn"
                                id="session-user-badge"
                                onClick={() => setIsSwitcherOpen(true)}
                                title="Click to switch persona"
                            >
                                <span className="user-dot"></span>
                                <span className="user-name">{user.displayName}</span>
                                <span className={`role-pill role-${user.role}`}>{user.role}</span>
                                <span className="switch-hint">⇄ Switch</span>
                            </button>

                            <button
                                className="btn-secondary"
                                id="logout-btn"
                                onClick={() => logout()}
                            >
                                Sign Out
                            </button>
                        </>
                    ) : (
                        <button
                            className="action-btn"
                            id="login-btn"
                            onClick={() => setIsSwitcherOpen(true)}
                        >
                            Sign In / Select User
                        </button>
                    )}
                </div>
            </header>

            <UserSwitcherModal
                isOpen={isSwitcherOpen}
                onClose={() => setIsSwitcherOpen(false)}
            />
        </>
    );
}
