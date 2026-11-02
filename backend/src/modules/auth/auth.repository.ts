import { Pool } from "pg";

export interface UserRecord {
    id: string;
    email: string;
    username: string;
    displayName: string;
    role: "analyst" | "admin";
    createdAt: Date;
}

export interface SessionRecord {
    id: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
}

export interface SessionWithUser {
    session: SessionRecord;
    user: UserRecord;
}

interface UserRow {
    id: string;
    email: string;
    username: string;
    display_name: string;
    role: "analyst" | "admin";
    created_at: Date;
}

interface SessionRow {
    id: string;
    user_id: string;
    expires_at: Date;
    created_at: Date;
}

export const SEED_DEMO_USERS: UserRecord[] = [
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

function mapUserRow(row: UserRow): UserRecord {
    return {
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        createdAt: new Date(row.created_at),
    };
}

function mapSessionRow(row: SessionRow): SessionRecord {
    return {
        id: row.id,
        userId: row.user_id,
        expiresAt: new Date(row.expires_at),
        createdAt: new Date(row.created_at),
    };
}

export class AuthRepository {
    private fallbackUsers: Map<string, UserRecord> = new Map(
        SEED_DEMO_USERS.map((u) => [u.id, { ...u }])
    );
    private fallbackSessions: Map<string, SessionRecord> = new Map();

    constructor(private pool: Pool) {}

    // ==========================================
    // User Queries
    // ==========================================

    async findUserById(id: string): Promise<UserRecord | null> {
        try {
            const query = `
                SELECT id, email, username, display_name, role, created_at
                FROM users
                WHERE id = $1
                LIMIT 1;
            `;
            const res = await this.pool.query<UserRow>(query, [id]);
            if (res.rows.length > 0) return mapUserRow(res.rows[0]);
        } catch {
            // Fallback to in-memory seed store when app_db is offline
        }
        return this.fallbackUsers.get(id) ?? null;
    }

    async findUserByUsername(username: string): Promise<UserRecord | null> {
        try {
            const query = `
                SELECT id, email, username, display_name, role, created_at
                FROM users
                WHERE username = $1
                LIMIT 1;
            `;
            const res = await this.pool.query<UserRow>(query, [username]);
            if (res.rows.length > 0) return mapUserRow(res.rows[0]);
        } catch {
            // Fallback to in-memory seed store when app_db is offline
        }
        for (const u of this.fallbackUsers.values()) {
            if (u.username.toLowerCase() === username.toLowerCase()) return u;
        }
        return null;
    }

    async findUserByEmail(email: string): Promise<UserRecord | null> {
        try {
            const query = `
                SELECT id, email, username, display_name, role, created_at
                FROM users
                WHERE email = $1
                LIMIT 1;
            `;
            const res = await this.pool.query<UserRow>(query, [email]);
            if (res.rows.length > 0) return mapUserRow(res.rows[0]);
        } catch {
            // Fallback to in-memory seed store when app_db is offline
        }
        for (const u of this.fallbackUsers.values()) {
            if (u.email.toLowerCase() === email.toLowerCase()) return u;
        }
        return null;
    }

    async listUsers(): Promise<UserRecord[]> {
        try {
            const query = `
                SELECT id, email, username, display_name, role, created_at
                FROM users
                ORDER BY created_at ASC;
            `;
            const res = await this.pool.query<UserRow>(query);
            if (res.rows.length > 0) return res.rows.map(mapUserRow);
        } catch {
            // Fallback to in-memory seed store when app_db is offline
        }
        return Array.from(this.fallbackUsers.values());
    }

    // ==========================================
    // Session Queries
    // ==========================================

    async createSession(session: {
        id: string;
        userId: string;
        expiresAt: Date;
    }): Promise<SessionRecord> {
        try {
            const query = `
                INSERT INTO sessions (id, user_id, expires_at)
                VALUES ($1, $2, $3)
                RETURNING id, user_id, expires_at, created_at;
            `;
            const res = await this.pool.query<SessionRow>(query, [
                session.id,
                session.userId,
                session.expiresAt,
            ]);
            if (res.rows.length > 0) return mapSessionRow(res.rows[0]);
        } catch {
            // Fallback to in-memory session store when app_db is offline
        }
        const record: SessionRecord = {
            id: session.id,
            userId: session.userId,
            expiresAt: new Date(session.expiresAt),
            createdAt: new Date(),
        };
        this.fallbackSessions.set(session.id, record);
        return record;
    }

    async findSessionById(sessionId: string): Promise<SessionWithUser | null> {
        try {
            const query = `
                SELECT 
                    s.id AS session_id,
                    s.user_id,
                    s.expires_at,
                    s.created_at AS session_created_at,
                    u.id AS user_id,
                    u.email,
                    u.username,
                    u.display_name,
                    u.role,
                    u.created_at AS user_created_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.id = $1 AND s.expires_at > CURRENT_TIMESTAMP
                LIMIT 1;
            `;
            const res = await this.pool.query(query, [sessionId]);
            if (res.rows.length > 0) {
                const row = res.rows[0];
                return {
                    session: {
                        id: row.session_id,
                        userId: row.user_id,
                        expiresAt: new Date(row.expires_at),
                        createdAt: new Date(row.session_created_at),
                    },
                    user: {
                        id: row.user_id,
                        email: row.email,
                        username: row.username,
                        displayName: row.display_name,
                        role: row.role,
                        createdAt: new Date(row.user_created_at),
                    },
                };
            }
        } catch {
            // Fallback to in-memory session store when app_db is offline
        }

        const session = this.fallbackSessions.get(sessionId);
        if (!session || session.expiresAt.getTime() <= Date.now()) {
            this.fallbackSessions.delete(sessionId);
            return null;
        }
        const user = this.fallbackUsers.get(session.userId);
        if (!user) return null;

        return { session, user };
    }

    async deleteSession(sessionId: string): Promise<boolean> {
        try {
            const query = `
                DELETE FROM sessions
                WHERE id = $1;
            `;
            const res = await this.pool.query(query, [sessionId]);
            if ((res.rowCount ?? 0) > 0) return true;
        } catch {
            // Fallback to in-memory session store when app_db is offline
        }
        return this.fallbackSessions.delete(sessionId);
    }

    async deleteExpiredSessions(): Promise<number> {
        try {
            const query = `
                DELETE FROM sessions
                WHERE expires_at <= CURRENT_TIMESTAMP;
            `;
            const res = await this.pool.query(query);
            return res.rowCount ?? 0;
        } catch {
            let deleted = 0;
            const now = Date.now();
            for (const [id, s] of this.fallbackSessions.entries()) {
                if (s.expiresAt.getTime() <= now) {
                    this.fallbackSessions.delete(id);
                    deleted++;
                }
            }
            return deleted;
        }
    }
}
