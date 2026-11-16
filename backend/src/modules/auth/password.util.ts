import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Hashes a plaintext password using scrypt with a cryptographic random 16-byte salt.
 * Output format: `scrypt$<saltHex>$<derivedKeyHex>`
 */
export function hashPassword(password: string): string {
    if (!password || typeof password !== "string") {
        throw new Error("Password must be a non-empty string");
    }
    const salt = randomBytes(SALT_BYTES).toString("hex");
    const derivedKey = scryptSync(password, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

/**
 * Verifies a plaintext password against a stored `scrypt$<saltHex>$<derivedKeyHex>` hash
 * using constant-time comparison to prevent timing side-channel attacks.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
    if (!password || !storedHash || typeof password !== "string" || typeof storedHash !== "string") {
        return false;
    }

    const parts = storedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") {
        return false;
    }

    const [, salt, hashHex] = parts;
    if (!salt || !hashHex) {
        return false;
    }

    try {
        const expectedBuffer = Buffer.from(hashHex, "hex");
        if (expectedBuffer.length !== SCRYPT_KEYLEN) {
            return false;
        }
        const actualBuffer = scryptSync(password, salt, SCRYPT_KEYLEN);
        return timingSafeEqual(actualBuffer, expectedBuffer);
    } catch {
        return false;
    }
}
