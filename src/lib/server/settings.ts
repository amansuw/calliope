import path from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { FORMAT_PRESET_IDS } from '$lib/formats';
import { db, schema } from './db';
import { env } from './env';
import { bus } from './events';

const str = (d = '') => z.string().trim().default(d);

export const SettingsSchema = z.object({
	paths: z
		.object({
			libraryDir: str(),
			stagingDir: str(),
			quarantineDir: str()
		})
		.prefault({}),
	pipeline: z
		.object({
			concurrency: z.number().int().min(1).max(8).default(2),
			formatPreset: z.enum(FORMAT_PRESET_IDS).default('mp3-320'),
			pathTemplate: str('{albumartist|artist}/{album|Singles}/[{track:02} - ]{title}'),
			/** Skip tracks already present in the library index */
			skipExisting: z.boolean().default(true),
			/** Below this, a match is flagged low-confidence (still downloaded) */
			lowConfidenceScore: z.number().min(0).max(1).default(0.6),
			/** Below this, the track fails instead of downloading a likely-wrong song */
			rejectScore: z.number().min(0).max(1).default(0.35),
			maxAttempts: z.number().int().min(1).max(10).default(3),
			preferYtMusic: z.boolean().default(true),
			/** Look up album, track numbers, year, genres and cover art on MusicBrainz */
			enrichMusicBrainz: z.boolean().default(true)
		})
		.prefault({}),
	ytdlp: z
		.object({
			sponsorblock: z.boolean().default(true),
			sponsorblockCategories: z.array(z.string()).default(['music_offtopic', 'intro', 'outro']),
			cookiesFile: str(),
			cookiesFromBrowser: str(),
			rateLimit: str(),
			concurrentFragments: z.number().int().min(1).max(16).default(4),
			extraArgs: str()
		})
		.prefault({}),
	binaries: z
		.object({
			ytdlp: str(),
			ffmpeg: str(),
			ffprobe: str(),
			fpcalc: str()
		})
		.prefault({}),
	spotify: z
		.object({
			clientId: str(),
			clientSecret: str()
		})
		.prefault({}),
	lyrics: z
		.object({
			enabled: z.boolean().default(true),
			preferSynced: z.boolean().default(true),
			writeLrcFile: z.boolean().default(false)
		})
		.prefault({}),
	navidrome: z
		.object({
			enabled: z.boolean().default(false),
			url: str(),
			user: str(),
			password: str()
		})
		.prefault({}),
	discord: z
		.object({
			enabled: z.boolean().default(false),
			webhookUrl: str(),
			botToken: str(),
			channelId: str(),
			notifyCompleted: z.boolean().default(true),
			notifyNewTracks: z.boolean().default(true),
			notifyErrors: z.boolean().default(true)
		})
		.prefault({}),
	acoustid: z
		.object({
			apiKey: str()
		})
		.prefault({}),
	soulseek: z
		.object({
			enabled: z.boolean().default(false),
			username: str(),
			password: str(),
			/** Port other users connect to. Results and transfers work best when it is reachable. */
			listenPort: z.number().int().min(1024).max(65535).default(2234),
			/** FLAC downloads look for a real lossless copy here before falling back to YouTube */
			autoLossless: z.boolean().default(true),
			/** Give up on a peer that keeps a download queued this long (retried later) */
			queueTimeoutMinutes: z.number().int().min(1).max(720).default(10)
		})
		.prefault({}),
	library: z
		.object({
			scanOnStartup: z.boolean().default(true),
			rescanIntervalMinutes: z.number().int().min(0).default(360),
			normalizePlayback: z.boolean().default(true)
		})
		.prefault({})
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsSection = keyof Settings;

/** Paths into the settings object whose values never leave the server in clear text. */
export const SECRET_FIELDS = [
	['spotify', 'clientSecret'],
	['navidrome', 'password'],
	['discord', 'webhookUrl'],
	['discord', 'botToken'],
	['acoustid', 'apiKey'],
	['soulseek', 'password']
] as const;
export const SECRET_MASK = '••••••••';

let cache: Settings | null = null;

/** Folders are stored absolute: paths relative to wherever the server happened to start are fragile. */
function absolutePaths(s: Settings): Settings {
	for (const k of ['libraryDir', 'stagingDir', 'quarantineDir'] as const) {
		if (s.paths[k]) s.paths[k] = path.resolve(s.paths[k]);
	}
	return s;
}

function defaults(): Settings {
	const s = SettingsSchema.parse({});
	s.paths.libraryDir = env.musicDir ?? path.join(env.dataDir, 'music');
	s.paths.stagingDir = env.stagingDir ?? path.join(env.dataDir, 'staging');
	s.paths.quarantineDir = path.join(env.dataDir, 'quarantine');
	return s;
}

export function getSettings(): Settings {
	if (cache) return cache;
	const rows = db.select().from(schema.settings).all();
	const stored: Record<string, unknown> = {};
	for (const row of rows) stored[row.key] = row.value;
	const base = defaults();
	const merged: Record<string, unknown> = {};
	for (const key of Object.keys(base) as SettingsSection[]) {
		merged[key] = { ...base[key], ...((stored[key] as object) ?? {}) };
	}
	const parsed = SettingsSchema.safeParse(merged);
	// A bad stored value (e.g. from an older version) shouldn't brick the app — fall back per field.
	cache = absolutePaths(parsed.success ? parsed.data : base);
	return cache;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

export function updateSettings(patch: DeepPartial<Settings>): Settings {
	const current = getSettings();
	const next: Record<string, Record<string, unknown>> = structuredClone(current) as never;
	for (const [section, values] of Object.entries(patch)) {
		if (!values || !(section in next)) continue;
		for (const [k, v] of Object.entries(values)) {
			if (v === undefined || v === SECRET_MASK) continue;
			next[section][k] = v;
		}
	}
	const parsed = absolutePaths(SettingsSchema.parse(next));
	db.transaction((tx) => {
		for (const section of Object.keys(patch) as SettingsSection[]) {
			tx.insert(schema.settings)
				.values({ key: section, value: parsed[section] })
				.onConflictDoUpdate({ target: schema.settings.key, set: { value: parsed[section] } })
				.run();
		}
	});
	cache = parsed;
	bus.emit('settings', publicSettings());
	return parsed;
}

/** Settings as sent to the browser: secrets replaced by a mask when set. */
export function publicSettings(): Settings {
	const s = structuredClone(getSettings()) as Record<string, Record<string, unknown>>;
	for (const [section, key] of SECRET_FIELDS) {
		if (s[section][key]) s[section][key] = SECRET_MASK;
	}
	return s as unknown as Settings;
}

// --- raw key/value for internal state (password hash etc.) that isn't user settings ---

export function getInternal<T>(key: string): T | undefined {
	const row = db
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, `_${key}`))
		.get();
	return row?.value as T | undefined;
}

export function setInternal(key: string, value: unknown) {
	db.insert(schema.settings)
		.values({ key: `_${key}`, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value } })
		.run();
}
