import crypto from "crypto";

/**
 * Trigger a Navidrome library rescan via the Subsonic API.
 * Uses /rest/startScan endpoint with token-based auth.
 */
export async function triggerNavidromeScan(): Promise<boolean> {
  const baseUrl = process.env.NAVIDROME_URL;
  const user = process.env.NAVIDROME_USER;
  const password = process.env.NAVIDROME_PASSWORD;

  if (!baseUrl || !user || !password) {
    console.log("[navidrome] Not configured, skipping rescan");
    return false;
  }

  try {
    // Subsonic token auth: salt + md5(password + salt)
    const salt = crypto.randomBytes(8).toString("hex");
    const token = crypto
      .createHash("md5")
      .update(password + salt)
      .digest("hex");

    const params = new URLSearchParams({
      u: user,
      t: token,
      s: salt,
      v: "1.16.1",
      c: "calliope",
      f: "json",
    });

    const res = await fetch(
      `${baseUrl}/rest/startScan?${params}`,
      { method: "GET" }
    );

    if (!res.ok) {
      console.error(`[navidrome] Scan trigger failed: ${res.status}`);
      return false;
    }

    const data = await res.json();
    if (data?.["subsonic-response"]?.status === "ok") {
      console.log("[navidrome] Library rescan triggered");
      return true;
    }

    console.error("[navidrome] Unexpected response:", data);
    return false;
  } catch (err) {
    console.error("[navidrome] Error triggering scan:", err);
    return false;
  }
}
