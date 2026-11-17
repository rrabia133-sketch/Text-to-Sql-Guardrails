import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, Eye, EyeOff, Lock, UserCheck, UserPlus } from "lucide-react";
import { useAuth } from "./AuthContext";

interface AuthWelcomeScreenProps {
    onOpenModal?: () => void;
}

export function AuthWelcomeScreen({ onOpenModal: _onOpenModal }: AuthWelcomeScreenProps) {
    const { authConfig, availableUsers, login, register } = useAuth();
    const [mode, setMode] = useState<"signin" | "register">("signin");
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submittingQuickUser, setSubmittingQuickUser] = useState<string | null>(null);
    const [loginError, setLoginError] = useState<string | null>(null);

    const handleFormSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoginError(null);

        if (!username.trim()) {
            setLoginError("Username or email is required.");
            return;
        }
        if ((authConfig.passwordRequired || mode === "register") && !password) {
            setLoginError("Password is required.");
            return;
        }

        try {
            setSubmitting(true);
            if (mode === "register") {
                await register({
                    username: username.trim(),
                    email: email.trim(),
                    password,
                    ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
                });
            } else {
                await login(username.trim(), password);
            }
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Authentication failed. Check your credentials and try again.";
            setLoginError(message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleQuickLogin = async (sandboxUsername: string) => {
        try {
            setLoginError(null);
            setSubmittingQuickUser(sandboxUsername);
            await login(sandboxUsername);
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Failed to sign in. Ensure backend and app_db are running.";
            setLoginError(message);
        } finally {
            setSubmittingQuickUser(null);
        }
    };

    const showSandboxQuickLogin = !authConfig.passwordRequired && availableUsers.length > 0;
    const sandboxUsers = availableUsers.filter(
        (u) => u.role === "admin" || u.username === "admin_user"
    );
    const quickUsersToRender =
        sandboxUsers.length > 0 ? sandboxUsers : availableUsers.slice(0, 1);

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

                {/* Right Column: Credential Sign-In / Registration Panel */}
                <div className="auth-signin-panel">
                    <div className="auth-signin-header">
                        <div className="signin-shield-badge" aria-hidden="true">
                            {mode === "register" ? <UserPlus size={18} /> : <Lock size={18} />}
                        </div>
                        <div>
                            <h3 className="signin-title">
                                {mode === "register" ? "Create Analyst Account" : "Sign In to Workspace"}
                            </h3>
                            <p className="signin-subtitle">
                                {mode === "register"
                                    ? "Register a personal analyst account protected with scrypt password hashing."
                                    : "Enter your username or email and password to start an authenticated session."}
                            </p>
                        </div>
                    </div>

                    {authConfig.registrationEnabled && (
                        <div className="auth-mode-tabs" role="tablist" aria-label="Authentication Mode">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mode === "signin"}
                                className={`auth-mode-tab ${mode === "signin" ? "active" : ""}`}
                                onClick={() => {
                                    setMode("signin");
                                    setLoginError(null);
                                }}
                            >
                                Sign In
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mode === "register"}
                                className={`auth-mode-tab ${mode === "register" ? "active" : ""}`}
                                onClick={() => {
                                    setMode("register");
                                    setLoginError(null);
                                }}
                            >
                                Create Account
                            </button>
                        </div>
                    )}

                    {loginError && (
                        <div className="error-alert-banner" role="alert">
                            <AlertTriangle size={15} />
                            <span>{loginError}</span>
                        </div>
                    )}

                    <form className="auth-form" onSubmit={(e) => void handleFormSubmit(e)}>
                        <div className="auth-field">
                            <label htmlFor="auth-username" className="auth-label">
                                {mode === "register" ? "Username" : "Username or Email"}
                            </label>
                            <input
                                id="auth-username"
                                name="username"
                                type="text"
                                className="auth-input"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder={mode === "register" ? "e.g. jane_analyst" : "username or email@company.com"}
                                autoComplete="username"
                                required
                                disabled={submitting || submittingQuickUser !== null}
                            />
                        </div>

                        {mode === "register" && (
                            <>
                                <div className="auth-field">
                                    <label htmlFor="auth-email" className="auth-label">
                                        Work Email
                                    </label>
                                    <input
                                        id="auth-email"
                                        name="email"
                                        type="email"
                                        className="auth-input"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="jane@company.com"
                                        autoComplete="email"
                                        required
                                        disabled={submitting}
                                    />
                                </div>

                                <div className="auth-field">
                                    <label htmlFor="auth-display-name" className="auth-label">
                                        Display Name (optional)
                                    </label>
                                    <input
                                        id="auth-display-name"
                                        name="displayName"
                                        type="text"
                                        className="auth-input"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="Jane Doe"
                                        autoComplete="name"
                                        disabled={submitting}
                                    />
                                </div>
                            </>
                        )}

                        <div className="auth-field">
                            <label htmlFor="auth-password" className="auth-label">
                                Password
                            </label>
                            <div className="auth-password-wrap">
                                <input
                                    id="auth-password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    className="auth-input"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={
                                        mode === "register"
                                            ? "Minimum 8 characters"
                                            : authConfig.passwordRequired
                                              ? "Enter your password"
                                              : "Password (required for password-protected accounts)"
                                    }
                                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                                    required={authConfig.passwordRequired || mode === "register"}
                                    minLength={mode === "register" ? 8 : undefined}
                                    disabled={submitting || submittingQuickUser !== null}
                                />
                                <button
                                    type="button"
                                    className="auth-password-toggle"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="action-btn auth-submit-btn"
                            disabled={submitting || submittingQuickUser !== null}
                        >
                            {submitting ? (
                                <span>{mode === "register" ? "Creating Account..." : "Signing In..."}</span>
                            ) : (
                                <>
                                    <span>{mode === "register" ? "Create Account & Sign In" : "Sign In"}</span>
                                    <ArrowRight size={15} />
                                </>
                            )}
                        </button>
                    </form>

                    {showSandboxQuickLogin && mode === "signin" && (
                        <>
                            <div className="auth-divider">
                                <span>or quick sandbox access (dev)</span>
                            </div>

                            <div className="auth-persona-grid" role="list" aria-label="Sandbox Personas">
                                {quickUsersToRender.map((u) => {
                                    const isLoading = submittingQuickUser === u.username;

                                    return (
                                        <button
                                            key={u.id}
                                            type="button"
                                            className="auth-persona-card"
                                            onClick={() => void handleQuickLogin(u.username)}
                                            disabled={submitting || submittingQuickUser !== null}
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
                                                    @{u.username} · Local development sandbox
                                                </span>
                                            </div>

                                            <span className="persona-arrow" aria-hidden="true">
                                                {isLoading ? (
                                                    <span className="btn-spinner-dark"></span>
                                                ) : (
                                                    <ArrowRight size={16} />
                                                )}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            </section>
        </main>
    );
}
