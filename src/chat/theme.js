export const defaultTheme = {
  brandName: "Mobstep Chat",
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
    input: 14
  },
  storage: {
    bucket: "chat-images"
  }
};

export function mergeTheme(base, override) {
  if (!override) return base;
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(override)) {
    if (override[k] && typeof override[k] === "object" && !Array.isArray(override[k])) {
      out[k] = mergeTheme(out[k] ?? {}, override[k]);
    } else {
      out[k] = override[k];
    }
  }
  return out;
}
