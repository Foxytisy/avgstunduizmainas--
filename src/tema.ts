import { type Tema, PRIEKSSKATS_ZINA, parklajumaUrl } from "./izmainas-dati.js";

let prieksskats = false;
let parklajums: HTMLImageElement | null = null;

function pielietot(t: Tema | undefined): void {
    const main = document.querySelector<HTMLElement>(".main");
    if (!main) return;
    const p = t?.parklajums;
    if (!p) {
        parklajums?.remove();
        parklajums = null;
        return;
    }
    if (!parklajums) {
        parklajums = document.createElement("img");
        parklajums.className = "parklajums";
        parklajums.alt = "";
        parklajums.draggable = false;
        main.append(parklajums);
    }
    const src = parklajumaUrl(p.id);
    if (parklajums.getAttribute("src") !== src) parklajums.src = src;
    parklajums.style.opacity = String(Math.min(100, Math.max(10, p.necaurspidigums)) / 100);
}

export function atjaunotTemu(t: Tema | undefined): void {
    if (!prieksskats) pielietot(t);
}

if (window.parent !== window) {
    window.addEventListener("message", e => {
        if (e.origin !== location.origin || e.source !== window.parent) return;
        const d = e.data as { tips?: string; tema?: Tema } | null;
        if (d?.tips !== PRIEKSSKATS_ZINA) return;
        prieksskats = true;
        pielietot(d.tema);
    });
}
