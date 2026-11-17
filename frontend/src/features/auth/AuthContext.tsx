import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { AuthConfigResponse, RegisterRequest, UserSummary } from "@text2sql/contracts";

export interface AuthContextType {
    user: UserSummary | null;
    loading: boolean;
    authConfig: AuthConfigResponse;
    availableUsers: UserSummary[];
    login: (username: string, password?: string) => Promise<void>;
    register: (input: RegisterRequest) => Promise<void>;
    logout: () => Promise<void>;
    refreshUsers: () => Promise<void>;
}

const DEFAULT_AUTH_CONFIG: AuthConfigResponse = {
    mode: "development",
    passwordRequired: false,
    registrationEnabled: true,
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [authConfig, setAuthConfig] = useState<AuthConfigResponse>(DEFAULT_AUTH_CONFIG);
    const [availableUsers, setAvailableUsers] = useState<UserSummary[]>([]);

    const refreshUsers = useCallback(async () => {
        try {
            const usersRes = await fetch("/api/auth/users", { credentials: "include" });
            if (usersRes.ok) {
                const data = await usersRes.json();
                if (Array.isArray(data)) {
                    setAvailableUsers(data);
                }
            } else if (usersRes.status === 401 || usersRes.status === 403) {
                setAvailableUsers([]);
            }
        } catch {
            // Ignore transient network errors during warmup
        }
    }, []);

    useEffect(() => {
        async function initAuth() {
            try {
                const [configRes, meRes] = await Promise.all([
                    fetch("/api/auth/config", { credentials: "include" }).catch(() => null),
                    fetch("/api/auth/me", { credentials: "include" }).catch(() => null),
                ]);

                if (configRes && configRes.ok) {
                    const cfg = (await configRes.json()) as AuthConfigResponse;
                    setAuthConfig(cfg);
                }

                if (meRes && meRes.ok) {
                    const data = await meRes.json();
                    setUser(data.user);
                } else {
                    setUser(null);
                }
            } catch {
                setUser(null);
            }

            try {
                await refreshUsers();
            } finally {
                setLoading(false);
            }
        }

        void initAuth();
    }, [refreshUsers]);

    const login = async (username: string, password?: string) => {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                username: username.trim(),
                ...(password !== undefined && password.length > 0 ? { password } : {}),
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || "Login failed");
        }

        const data = await res.json();
        setUser(data.user);
        await refreshUsers();
    };

    const register = async (input: RegisterRequest) => {
        const res = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(input),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || "Registration failed");
        }

        const data = await res.json();
        setUser(data.user);
        await refreshUsers();
    };

    const logout = async () => {
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "include",
            });
        } finally {
            setUser(null);
            await refreshUsers();
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                authConfig,
                availableUsers,
                login,
                register,
                logout,
                refreshUsers,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
