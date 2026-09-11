import { query } from "./db.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function buildAuthUrl(redirectUri) {
  const params = new URLSearchParams({
    client_id: requireEnv("GMAIL_OAUTH_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCodeForTokens(code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GMAIL_OAUTH_CLIENT_ID"),
      client_secret: requireEnv("GMAIL_OAUTH_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function saveRefreshToken(refreshToken) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('gmail_refresh_token', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [refreshToken]
  );
}

export async function getRefreshToken() {
  const { rows } = await query("SELECT value FROM app_settings WHERE key = 'gmail_refresh_token'");
  return rows[0]?.value || null;
}

export async function isConnected() {
  return Boolean(await getRefreshToken());
}

async function getAccessToken() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new Error("Gmail is not connected yet — visit /api/auth/gmail/start first.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GMAIL_OAUTH_CLIENT_ID"),
      client_secret: requireEnv("GMAIL_OAUTH_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Access token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function header(headers, name) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

// Returns [{ id, subject, from, snippet }] for unread inbox mail newer than
// `minutes` minutes old.
export async function listRecentUnread(minutes) {
  const accessToken = await getAccessToken();
  // Gmail's newer_than/older_than operators only support day/month/year
  // granularity, not minutes or hours — so we fetch recent unread mail
  // (most recent first) and filter to the exact window ourselves below via
  // internalDate, rather than relying on any search-operator time unit.
  const q = encodeURIComponent("is:unread in:inbox");
  const listRes = await fetch(`${GMAIL_API}/messages?q=${q}&maxResults=25`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text()}`);
  const { messages = [] } = await listRes.json();

  const cutoff = Date.now() - minutes * 60 * 1000;
  const results = [];
  for (const m of messages) {
    const msgRes = await fetch(
      `${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!msgRes.ok) continue;
    const msg = await msgRes.json();
    if (Number(msg.internalDate) < cutoff) continue;
    results.push({
      id: msg.id,
      subject: header(msg.payload.headers, "Subject"),
      from: header(msg.payload.headers, "From"),
      snippet: msg.snippet || "",
    });
  }
  return results;
}

const URGENT_PATTERN =
  /urgent|emergency|no heat|no hot water|water leak|flood|gas smell|fire\b|break-?in|lockout|eviction|nsf|bounced|maintenance request/i;
const MAINTENANCE_PATTERN = /maintenance|leak|heat|plumbing|electrical|repair|hvac/i;

export function judgeUrgency({ subject, snippet }) {
  const text = `${subject} ${snippet}`;
  if (!URGENT_PATTERN.test(text)) return null;
  return {
    category: MAINTENANCE_PATTERN.test(text) ? "maintenance" : "ops",
  };
}
