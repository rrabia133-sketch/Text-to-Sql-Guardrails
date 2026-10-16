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
    constructor(private pool: Pool) { }

    // ==========================================
    // User Queries
    // ==========================================

    async findUserById(id: string): Promise<UserRecord | null> {
        const query = `
            SELECT id, email, username, display_name, role, created_at
            FROM users
            WHERE id = $1
            LIMIT 1;
        `;
        const res = await this.pool.query<UserRow>(query, [id]);
        if (res.rows.length === 0) return null;
        return mapUserRow(res.rows[0]);
    }

    async findUserByUsername(username: string): Promise<UserRecord | null> {
        const query = `
            SELECT id, email, username, display_name, role, created_at
            FROM users
            WHERE username = $1
            LIMIT 1;
        `;
        const res = await this.pool.query<UserRow>(query, [username]);
        if (res.rows.length === 0) return null;
        return mapUserRow(res.rows[0]);
    }

    async findUserByEmail(email: string): Promise<UserRecord | null> {
        const query = `
            SELECT id, email, username, display_name, role, created_at
            FROM users
            WHERE email = $1
            LIMIT 1;
        `;
        const res = await this.pool.query<UserRow>(query, [email]);
        if (res.rows.length === 0) return null;
        return mapUserRow(res.rows[0]);
    }

    async listUsers(): Promise<UserRecord[]> {
        const query = `
            SELECT id, email, username, display_name, role, created_at
            FROM users
            ORDER BY created_at ASC;
        `;
        const res = await this.pool.query<UserRow>(query);
        return res.rows.map(mapUserRow);
    }

    // ==========================================
    // Session Queries
    // ==========================================

    async createSession(session: {
        id: string;
        userId: string;
        expiresAt: Date;
    }): Promise<SessionRecord> {
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
        return mapSessionRow(res.rows[0]);
    }

    async findSessionById(sessionId: string): Promise<SessionWithUser | null> {
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
        if (res.rows.length === 0) return null;

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

    async deleteSession(sessionId: string): Promise<boolean> {
        const query = `
            DELETE FROM sessions
            WHERE id = $1;
        `;
        const res = await this.pool.query(query, [sessionId]);
        return (res.rowCount ?? 0) > 0;
    }

    async deleteExpiredSessions(): Promise<number> {
        const query = `
            DELETE FROM sessions
            WHERE expires_at <= CURRENT_TIMESTAMP;
        `;
        const res = await this.pool.query(query);
        return res.rowCount ?? 0;
    }
}
