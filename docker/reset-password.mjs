#!/usr/bin/env node
// Forgot the password?  docker exec -it calliope node reset-password.mjs
// Prompts for a new one, stores its hash and signs out every session. No restart needed.
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import Database from 'better-sqlite3';

// Must match hashPassword() in src/lib/server/auth.ts
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function ask(question) {
	if (!process.stdin.isTTY) {
		console.error('Run with a terminal: docker exec -it calliope node reset-password.mjs');
		process.exit(1);
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	// Keep the typed password off the screen
	rl._writeToOutput = (s) => {
		if (s.includes(question)) rl.output.write(question);
	};
	return new Promise((resolve) =>
		rl.question(question, (answer) => {
			rl.close();
			process.stdout.write('\n');
			resolve(answer);
		})
	);
}

const password = await ask('New password (min 8 characters): ');
if (password.length < 8) {
	console.error('Too short — nothing changed.');
	process.exit(1);
}
if ((await ask('Repeat it: ')) !== password) {
	console.error("Passwords don't match — nothing changed.");
	process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
const value = JSON.stringify({ salt: salt.toString('base64'), hash: hash.toString('base64') });

const db = new Database(
	path.join(path.resolve(process.env.CALLIOPE_DATA_DIR || './data'), 'calliope.sqlite'),
	{ fileMustExist: true }
);
db.pragma('busy_timeout = 5000');
db.transaction(() => {
	db.prepare(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run('_password', value);
	db.prepare('DELETE FROM sessions').run();
})();
console.log('Password updated. All sessions were signed out.');
