export const defaultTheme = {
  brandName: "Mobstep Chat",
  logoUrl: "",
  showTime: true,
  placeholder: "Write a message…",
  sendLabel: "Send",
  colors: {
    background: "#0b1220",
    header: "#0f172a",
    headerText: "#ffffff",
    bubbleCustomer: "#2563eb",
    bubbleAgent: "#1f2937",
    bubbleText: "#ffffff",
    bubbleSubtleText: "rgba(255,255,255,0.75)",
    inputBg: "#111827",
    inputText: "#ffffff",
    inputBorder: "rgba(255,255,255,0.12)",
    border: "rgba(255,255,255,0.12)",
    accent: "#60a5fa",
    buttonText: "#081018",
    buttonIcon: "#081018",
    buttonBorder: "rgba(255,255,255,0.12)",
    footerBg: "#0b1220",
    danger: "#ef4444"
  },
  radius: {
    container: 16,
    bubble: 16,
    // Fall back to `bubble` when the backend does not send per-side values.
    bubbleCustomer: null,
    bubbleAgent: null,
    input: 14
  },
  // Font stack covers Latin and Arabic; the backend can override `family`.
  font: {
    family:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", "Helvetica Neue", Arial, sans-serif',
    size: 15,
    metaSize: 11
  },
  sizes: {
    // Widget shell
    maxWidth: 560,
    // Header
    headerHeight: 56,
    logoSize: 30,
    titleSize: 16,
    // Composer
    inputMinHeight: 44,
    inputMaxHeight: 132,
    buttonSize: 44,
    // Messages
    bubbleMaxWidth: 78,
    imageMaxWidth: 260
  },
  storage: {
    bucket: "chat-images"
  }
};

export function mergeTheme(base, override) {
  if (!override) return base;
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(override)) {
    if (override[k] === null || override[k] === undefined) continue;
    if (override[k] && typeof override[k] === "object" && !Array.isArray(override[k])) {
      out[k] = mergeTheme(out[k] ?? {}, override[k]);
    } else {
      out[k] = override[k];
    }
  }
  return out;
}

/**
 * Normalise the /customer-support/config payload into a theme override.
 * The endpoint returns some values inside `theme` and some as siblings
 * (logo_url, show_time, resolved copy), so both shapes are folded in here.
 */
export function themeFromConfig(json) {
  if (!json || typeof json !== "object") return null;

  const theme = json.theme && typeof json.theme === "object" ? { ...json.theme } : {};

  // `logo` is an array of upload records in some responses; `logoUrl` wins.
  delete theme.logo;

  const logoUrl = theme.logoUrl || json.logo_url || "";
  const placeholder = json.input_placeholder_resolved || json.input_placeholder || "";
  const sendLabel = json.send_button_text_resolved || json.send_button_text || "";
  const brandName = theme.brandName || json.brand_name_resolved || json.brand_name || "";
  const showTime = typeof json.show_time === "boolean" ? json.show_time : theme.showTime;

  return {
    ...theme,
    ...(brandName ? { brandName } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(sendLabel ? { sendLabel } : {}),
    ...(typeof showTime === "boolean" ? { showTime } : {})
  };
}
