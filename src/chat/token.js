function base64UrlToJson(input) {
  // Convert Base64URL back to standard Base64
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding back (Android removes it with .replace("=", ""))
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return JSON.parse(atob(padded));
}

export function parseWidgetParams(search) {
  const params = new URLSearchParams(search);
  const token = params.get("token") || "";
  const themeParam = params.get("theme");
  let themeOverride = null;

  if (themeParam) {
    try {
      themeOverride = base64UrlToJson(themeParam);
    } catch {
      themeOverride = null;
    }
  }

  return { token, themeOverride };
}

export function decodeJwtClaims(token) {
  const parts = String(token).split(".");
  if (parts.length < 2) throw new Error("Invalid token");
  const payload = base64UrlToJson(parts[1]);
  const application_id = Number(payload.application_id);
  const identifier = String(payload.identifier ?? "");
  if (!Number.isFinite(application_id)) throw new Error("Missing/invalid application_id");
  if (!identifier) throw new Error("Missing/invalid identifier");
  return { application_id, identifier };
}
