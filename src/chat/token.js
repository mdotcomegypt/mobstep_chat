function base64UrlToJson(input) {
  // Convert Base64URL back to standard Base64
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding back (Android removes it with .replace("=", ""))
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  // atob() yields a binary (latin-1) string, so decode it as UTF-8 before parsing;
  // otherwise any non-ASCII character in the payload corrupts the JSON.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

const RTL_LANGS = ["ar", "he", "fa", "ur", "ps", "sd", "ckb", "dv", "yi"];

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

  // Optional hints from the host app: ?dir=rtl or ?lang=ar
  const dirParam = (params.get("dir") || "").toLowerCase();
  const lang = (params.get("lang") || "").toLowerCase().split(/[-_]/)[0];
  let dir = null;
  if (dirParam === "rtl" || dirParam === "ltr") dir = dirParam;
  else if (lang) dir = RTL_LANGS.includes(lang) ? "rtl" : "ltr";

  return { token, themeOverride, dir };
}

/** Fallback when the host app sends no language hint: sniff the theme copy. */
export function detectDir(...samples) {
  const rtlChars = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
  return samples.some((s) => typeof s === "string" && rtlChars.test(s)) ? "rtl" : "ltr";
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
