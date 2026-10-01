export interface Preferences { muted: boolean; reducedMotion: boolean }
const KEY = "critstorm-preferences";

/** preserve sound and motion choices, falling back to the system motion preference. */
export function loadPreferences(): Preferences {
    const defaults = { muted: false, reducedMotion: typeof window !== "undefined" &&
        typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches };
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
        if (typeof raw !== "object" || !raw) return defaults;
        const saved = raw as Record<string, unknown>;
        return { muted: typeof saved.muted === "boolean" ? saved.muted : defaults.muted,
            reducedMotion: typeof saved.reducedMotion === "boolean" ? saved.reducedMotion : defaults.reducedMotion };
    } catch { return defaults; }
}

/** save cosmetic choices without making unavailable browser storage a game failure. */
export function savePreferences(preferences: Preferences): void {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* storage may be unavailable */ }
}
