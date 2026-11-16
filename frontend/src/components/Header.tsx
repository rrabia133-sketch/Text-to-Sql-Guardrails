import { useState } from "react";
import {
    ArrowLeftRight,
    LogIn,
    LogOut,
    ShieldCheck,
} from "lucide-react";
import { useAuth } from "../features/auth/AuthContext";
import { UserSwitcherModal } from "../features/auth/UserSwitcherModal";

export function Header() {
    const { user, logout } = useAuth();
    const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

    return (
        <>
            <header className="app-header">
                <div className="brand">
                    <div className="brand-icon" aria-hidden="true">
                        <ShieldCheck size={18} />
                    </div>
                    <h1 className="brand-title">Text-to-SQL Guardrails</h1>
                </div>

                <div className="header-meta">
                    {user ? (
                        <>
                            <button
                                type="button"
                                className="user-badge-btn"
                                id="session-user-badge"
                                onClick={() => setIsSwitcherOpen(true)}
                                title="Click to switch persona"
                            >
                                <span className="user-dot" aria-hidden="true"></span>
                                <span className="user-name">{user.displayName}</span>
                                <span className={`role-pill role-${user.role}`}>{user.role}</span>
                                <span className="switch-hint">
                                    <ArrowLeftRight size={12} />
                                    <span>Switch</span>
                                </span>
                            </button>

                            <button
                                type="button"
                                className="btn-secondary"
                                id="logout-btn"
                                onClick={() => logout()}
                            >
                                <LogOut size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                                <span>Sign Out</span>
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="action-btn"
                            id="login-btn"
                            onClick={() => setIsSwitcherOpen(true)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                        >
                            <LogIn size={15} />
                            <span>Sign In / Select User</span>
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
