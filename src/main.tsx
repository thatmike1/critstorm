import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
// self-hosted bitmap fonts (the game must work offline — no Google Fonts CDN):
// Press Start 2P = display words, Silkscreen = labels, VT323 = numerals.
import "@fontsource/press-start-2p/latin-400.css";
import "@fontsource/silkscreen/latin-400.css";
import "@fontsource/vt323/latin-400.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
