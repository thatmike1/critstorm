/// <reference types="vite/client" />
// PROTOTYPE — throwaway art-direction switcher for the sh8 presentation epic.
// three pixel-native skins of the storm HUD, switchable via ?skin=, judged
// against the live sim. delete this file (and prototype-skins.css) once a
// direction wins; the winner gets rebuilt properly in index.css.
import { useEffect } from "react";
import "./prototype-skins.css";

export type PrototypeSkinId = "current" | "cabinet" | "bare" | "marquee";

export const PROTOTYPE_SKINS: { id: PrototypeSkinId; name: string }[] = [
    { id: "current", name: "current (smooth CSS)" },
    { id: "cabinet", name: "A — pixel cabinet" },
    { id: "bare", name: "B — bare instrument" },
    { id: "marquee", name: "C — vegas marquee" },
];

/** read the ?skin= param once at mount; anything unknown falls back to current. */
export function readPrototypeSkin(): PrototypeSkinId {
    const raw = new URLSearchParams(window.location.search).get("skin");
    return PROTOTYPE_SKINS.some((s) => s.id === raw) ? (raw as PrototypeSkinId) : "current";
}

interface Props {
    skin: PrototypeSkinId;
    onChange(skin: PrototypeSkinId): void;
}

/** floating dev-only pill: arrows + label, ←/→ keys cycle, URL stays shareable. */
export function PrototypeSkinSwitcher({ skin, onChange }: Props) {
    const index = PROTOTYPE_SKINS.findIndex((s) => s.id === skin);

    const cycle = (dir: number) => {
        const next = PROTOTYPE_SKINS[(index + dir + PROTOTYPE_SKINS.length) % PROTOTYPE_SKINS.length];
        const params = new URLSearchParams(window.location.search);
        params.set("skin", next.id);
        window.history.replaceState(null, "", `?${params.toString()}`);
        onChange(next.id);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
                return;
            if (e.key === "ArrowLeft") cycle(-1);
            if (e.key === "ArrowRight") cycle(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index]);

    if (!import.meta.env.DEV) return null;

    return (
        <div className="proto-switcher">
            <button onClick={() => cycle(-1)}>◀</button>
            <span>{PROTOTYPE_SKINS[index].name}</span>
            <button onClick={() => cycle(1)}>▶</button>
        </div>
    );
}
