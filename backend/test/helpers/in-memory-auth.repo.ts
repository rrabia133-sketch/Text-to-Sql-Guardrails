import type { Pool } from "pg";
import {
    AuthRepository,
    type UserRecord,
    type SessionRecord,
    type SessionWithUser,
} from "../../src/modules/auth/auth.repository.js";

export const DEFAULT_MOCK_USERS: UserRecord[] = [
    {
        id: "usr_analyst_a",
        username: "analyst_a",
        email: "analyst-a@example.com",
        displayName: "Analyst Alice",
        role: "analyst",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
        id: "usr_analyst_b",
        username: "analyst_b",
        email: "analyst-b@example.com",
        displayName: "Analyst Bob",
        role: "analyst",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    {
        id: "usr_admin_01",
        username: "admin_user",
        email: "admin@example.com",
        displayName: "Admin",
        role: "admin",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
    },
];

export class InMemoryAuthRepository extends AuthRepository {
    private users: Map<string, UserRecord> = new Map();
    private sessions: Map<string, SessionRecord> = new Map();

    constructor(initialUsers: UserRecord[] = DEFAULT_MOCK_USERS) {
        // Pass dummy pool to base constructor
        super({
            query: async () => ({ rows: [], rowCount: 0 }),
            end: async () => {},
        } as unknown as Pool);

        for (const user of initialUsers) {
            this.users.set(user.id, { ...user });
        }
    }

    override async findUserById(id: string): Promise<UserRecord | null> {
        return this.users.get(id) ?? null;
    }

    override async findUserByUsername(username: string): Promise<UserRecord | null> {
        for (const user of this.users.values()) {
            if (user.username.toLowerCase() === username.toLowerCase()) {
                return user;
            }
        }
        return null;
    }

    override async findUserByEmail(email: string): Promise<UserRecord | null> {
        for (const user of this.users.values()) {
            if (user.email.toLowerCase() === email.toLowerCase()) {
                return user;
            }
        }
        return null;
    }

    override async listUsers(): Promise<UserRecord[]> {
        return Array.from(this.users.values()).sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
    }

    override async createSession(session: {
        id: string;
        userId: string;
        expiresAt: Date;
    }): Promise<SessionRecord> {
        const record: SessionRecord = {
            id: session.id,
            userId: session.userId,
            expiresAt: new Date(session.expiresAt),
            createdAt: new Date(),
        };
        this.sessions.set(session.id, record);
        return record;
    }

    override async findSessionById(sessionId: string): Promise<SessionWithUser | null> {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        // Expired sessions return null, exactly matching SQL: WHERE s.expires_at > CURRENT_TIMESTAMP
        if (session.expiresAt.getTime() <= Date.now()) {
            return null;
        }

        const user = this.users.get(session.userId);
        if (!user) return null;

        return {
            session: { ...session },
            user: { ...user },
        };
    }

    override async deleteSession(sessionId: string): Promise<boolean> {
        return this.sessions.delete(sessionId);
    }

    override async deleteExpiredSessions(): Promise<number> {
        const now = Date.now();
        let deleted = 0;
        for (const [id, sess] of this.sessions.entries()) {
            if (sess.expiresAt.getTime() <= now) {
                this.sessions.delete(id);
                deleted++;
            }
        }
        return deleted;
    }

    // ==========================================
    // Test utilities
    // ==========================================

    async getRawSession(sessionId: string): Promise<SessionRecord | null> {
        return this.sessions.get(sessionId) ?? null;
    }

    expireSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.expiresAt = new Date(Date.now() - 3600_000); // 1 hour ago
        }
    }

    addUser(user: UserRecord): void {
        this.users.set(user.id, { ...user });
    }

    clear(): void {
        this.sessions.clear();
    }
}
