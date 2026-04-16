import fs from "fs";
import path from "path";

const ENV_PATH = path.join(process.cwd(), ".env");

export interface EnvData {
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CHANNEL_ID?: string;
  NAVIDROME_URL?: string;
  NAVIDROME_USER?: string;
  NAVIDROME_PASSWORD?: string;
  TEMP_DOWNLOAD_DIR?: string;
  MUSIC_LIBRARY_DIR?: string;
  DATABASE_URL?: string;
  SPOTIFY_SCRAPER_CMD?: string;
  YTDLP_COOKIES_FILE?: string;
  YTDLP_COOKIES_FROM_BROWSER?: string;
}

function parseEnvFile(content: string): Map<string, string> {
  const env = new Map<string, string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env.set(key, value);
  }

  return env;
}

function serializeEnvFile(env: Map<string, string>): string {
  const lines: string[] = [];

  env.forEach((value, key) => {
    if (value) {
      lines.push(`${key}=${value}`);
    }
  });

  return lines.join("\n") + "\n";
}

export function readEnvFile(): EnvData {
  if (!fs.existsSync(ENV_PATH)) {
    return {};
  }

  try {
    const content = fs.readFileSync(ENV_PATH, "utf-8");
    const parsed = parseEnvFile(content);
    const result: EnvData = {};

    parsed.forEach((value, key) => {
      if (key in result) {
        (result as any)[key] = value;
      }
    });

    return result;
  } catch {
    return {};
  }
}

export function writeEnvFile(data: Partial<EnvData>): { success: boolean; error?: string } {
  try {
    let env = new Map<string, string>();

    if (fs.existsSync(ENV_PATH)) {
      const content = fs.readFileSync(ENV_PATH, "utf-8");
      env = parseEnvFile(content);
    }

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== "") {
        env.set(key, value);
      }
    }

    fs.writeFileSync(ENV_PATH, serializeEnvFile(env), "utf-8");
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function getEnvVar(key: keyof EnvData): string | undefined {
  const data = readEnvFile();
  return data[key];
}

export function setEnvVar(key: keyof EnvData, value: string): { success: boolean; error?: string } {
  return writeEnvFile({ [key]: value });
}

export function deleteEnvVar(key: keyof EnvData): { success: boolean; error?: string } {
  try {
    if (!fs.existsSync(ENV_PATH)) {
      return { success: true };
    }

    const content = fs.readFileSync(ENV_PATH, "utf-8");
    const env = parseEnvFile(content);
    env.delete(key);
    fs.writeFileSync(ENV_PATH, serializeEnvFile(env), "utf-8");

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}