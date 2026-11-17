import { useState, type FormEvent } from "react";
import { AlertTriangle, ShieldCheck, User, X } from "lucide-react";
import { useAuth } from "./AuthContext";

interface UserSwitcherModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function UserSwitcherModal({ isOpen, onClose }: UserSwitcherModalProps) {
    const { user, authConfig, availableUsers, login } = useAuth();
    const [submittingUser, setSubmittingUser] = useState<string | null>(null);
    const [usernameInput, setUsernameInput] = useState("");
    const [passwordInput, setPasswordInput] = useState("");
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSelect = async (username: string) => {
        try {
            setError(null);
            setSubmittingUser(username);
            await login(username);
            onClose();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to switch session.";
            setError(msg);
        } finally {
            setSubmittingUser(null);
        }
    };

    const handleCredentialLogin = async (e: FormEvent) => {
        e.preventDefault();
        if (!usernameInput.trim()) {
            setError("Username or email is required.");
            return;
        }
        try {
            setError(null);
            setSubmittingUser(usernameInput.trim());
            await login(usernameInput.trim(), passwordInput);
            setPasswordInput("");
            onClose();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Invalid credentials.";
            setError(msg);
        } finally {
            setSubmittingUser(null);
        }
    };

    const showSandboxList = !authConfig.passwordRequired && availableUsers.length > 0;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3 className="modal-title">
                            {showSandboxList ? "Switch Session Persona" : "Sign In with Credentials"}
                        </h3>
                        <p className="modal-subtitle">
                            {showSandboxList
                                ? "Select a sandbox user or sign in with credentials"
                                : "Enter your account credentials to authenticate"}
                        </p>
                    </div>
                    <button className="modal-close-btn" onClick={onClose} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>

                {error && (
                    <div className="error-alert-banner" role="alert" style={{ marginBottom: 14 }}>
                        <AlertTriangle size={15} />
                        <span>{error}</span>
                    </div>
                )}

                {showSandboxList ? (
                    <div className="user-persona-list">
                        {availableUsers.map((u) => {
                            const isActive = user?.id === u.id;
                            const isLoading = submittingUser === u.username;

                            return (
                                <button
                                    key={u.id}
                                    type="button"
                                    className={`user-persona-card ${isActive ? "active" : ""}`}
                                    onClick={() => void handleSelect(u.username)}
                                    disabled={submittingUser !== null}
                                >
                                    <div className="persona-avatar">
                                        {u.role === "admin" ? <ShieldCheck size={18} /> : <User size={18} />}
                                    </div>
                                    <div className="persona-details">
                                        <div className="persona-name-row">
                                            <span className="persona-name">{u.displayName}</span>
                                            <span className={`role-pill role-${u.role}`}>{u.role}</span>
                                        </div>
                                        <span className="persona-username">@{u.username}</span>
                                    </div>
                                    {isActive && <span className="active-badge">Active</span>}
                                    {isLoading && <span className="loading-spinner">...</span>}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <form className="auth-form" onSubmit={(e) => void handleCredentialLogin(e)}>
                        <div className="auth-field">
                            <label htmlFor="modal-username" className="auth-label">
                                Username or Email
                            </label>
                            <input
                                id="modal-username"
                                type="text"
                                className="auth-input"
                                value={usernameInput}
                                onChange={(e) => setUsernameInput(e.target.value)}
                                placeholder="username or email"
                                autoComplete="username"
                                required
                                disabled={submittingUser !== null}
                            />
                        </div>
                        <div className="auth-field">
                            <label htmlFor="modal-password" className="auth-label">
                                Password
                            </label>
                            <input
                                id="modal-password"
                                type="password"
                                className="auth-input"
                                value={passwordInput}
                                onChange={(e) => setPasswordInput(e.target.value)}
                                placeholder="Enter password"
                                autoComplete="current-password"
                                required={authConfig.passwordRequired}
                                disabled={submittingUser !== null}
                            />
                        </div>
                        <button
                            type="submit"
                            className="action-btn auth-submit-btn"
                            disabled={submittingUser !== null}
                        >
                            {submittingUser !== null ? "Signing In..." : "Sign In"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
