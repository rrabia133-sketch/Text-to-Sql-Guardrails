import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UserSummary } from "@text2sql/contracts";

export interface AuthContextType {
    user: UserSummary | null;
    loading: boolean;
    availableUsers: UserSummary[];
    login: (username: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [availableUsers, setAvailableUsers] = useState<UserSummary[]>([]);

    useEffect(() => {
        async function initAuth() {
            try {
                // 1. Restore session on page reload if session_id cookie exists
                const meRes = await fetch("/api/auth/me", { credentials: "include" });
                if (meRes.ok) {
                    const data = await meRes.json();
                    setUser(data.user);
                } else {
                    setUser(null);
                }
            } catch {
                setUser(null);
            }

            try {
                // 2. Fetch seed users for switcher
                const usersRes = await fetch("/api/auth/users");
                if (usersRes.ok) {
                    const data = await usersRes.json();
                    setAvailableUsers(data);
                }
            } catch (err) {
                console.error("Failed to load demo accounts:", err);
            } finally {
                setLoading(false);
            }
        }

        initAuth();
    }, []);

    const login = async (username: string) => {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ username }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || "Login failed");
        }

        const data = await res.json();
        setUser(data.user);
    };

    const logout = async () => {
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "include",
            });
        } finally {
            setUser(null);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, availableUsers, login, logout }}>
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
