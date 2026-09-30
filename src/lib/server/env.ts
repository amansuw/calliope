import fs from 'node:fs';
import path from 'node:path';

// Local dev convenience: pick up ./.env (Docker passes real env vars instead). Never overrides.
if (fs.existsSync('.env')) process.loadEnvFile('.env');

/** Process-level configuration. Everything user-tunable lives in the settings table instead. */
export const env = {
	dataDir: path.resolve(process.env.CALLIOPE_DATA_DIR || './data'),
	/** Initial password for Docker deployments; once a password is stored in the DB this is ignored. */
	initialPassword: process.env.CALLIOPE_PASSWORD || undefined,
	/** Defaults seeded into settings on first run */
	musicDir: process.env.MUSIC_DIR || process.env.MUSIC_LIBRARY_DIR || undefined,
	stagingDir: process.env.STAGING_DIR || process.env.TEMP_DOWNLOAD_DIR || undefined,
	/** Old Calliope database, offered for import on the settings page */
	legacyDb: process.env.LEGACY_DB || undefined,
	migrationsDir: path.resolve(process.env.CALLIOPE_MIGRATIONS_DIR || './drizzle')
};

export const dbPath = () => path.join(env.dataDir, 'calliope.sqlite');
