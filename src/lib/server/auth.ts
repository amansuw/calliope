import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { eq, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db, schema } from './db';
import { env } from './env';
import { getInternal, setInternal } from './settings';

const scrypt = promisify(crypto.scrypt) as (
	pw: string,
	salt: Buffer,
	len: number,
	opts: crypto.ScryptOptions
) => Promise<Buffer>;

export const SESSION_COOKIE = 'calliope_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

interface StoredHash {
	salt: string;
	hash: string;
}

export async function hashPassword(password: string): Promise<StoredHash> {
	const salt = crypto.randomBytes(16);
	const hash = await scrypt(password, salt, 32, SCRYPT);
	return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

async function verify(password: string, stored: StoredHash) {
	const hash = await scrypt(password, Buffer.from(stored.salt, 'base64'), 32, SCRYPT);
	const expected = Buffer.from(stored.hash, 'base64');
	return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

/** Seed the password from CALLIOPE_PASSWORD on first boot so Docker setups skip the setup screen. */
export async function ensurePasswordFromEnv() {
	if (!getInternal('password') && env.initialPassword) {
		setInternal('password', await hashPassword(env.initialPassword));
	}
}

export const hasPassword = () => !!getInternal<StoredHash>('password');

export async function setPassword(password: string) {
	setInternal('password', await hashPassword(password));
	// Changing the password logs out every other session.
	db.delete(schema.sessions).run();
}

export async function checkPassword(password: string) {
	const stored = getInternal<StoredHash>('password');
	return !!stored && (await verify(password, stored));
}

const sha = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(cookies: Cookies, secure: boolean) {
	const token = crypto.randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	db.insert(schema.sessions)
		.values({ id: sha(token), expiresAt })
		.run();
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export function validateSession(token: string | undefined) {
	if (!token) return false;
	const row = db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sha(token)))
		.get();
	if (!row) return false;
	if (row.expiresAt.getTime() < Date.now()) {
		db.delete(schema.sessions).where(eq(schema.sessions.id, row.id)).run();
		return false;
	}
	return true;
}

export function destroySession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token)
		db.delete(schema.sessions)
			.where(eq(schema.sessions.id, sha(token)))
			.run();
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function pruneSessions() {
	db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())).run();
}
