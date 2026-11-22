import {
    type IzmainuDati,
    createClassContainer,
    createClassNumber,
    formatAtjaunots,
    getStunda,
    klasesArIzmainam,
    loadIzmainas,
    todayKey,
    withTimeout,
} from "./izmainas-dati.js";

const RINDAS_LAPA = 4;
const ROTACIJA_MS = 8_000;
const FADE_MS = 300;
const POLL_MS = 30_000;  //intervāls ielādēšanai
const REQUEST_TIMEOUT_MS = 10_000;

let dati: IzmainuDati | null = null;
let lapa = 0;
let rotacijasTaimeris: number | undefined;
let pollTaimeris: number | undefined;
let started = false;

function getContainer(): HTMLElement {
    return document.querySelector<HTMLElement>(".izmainas .izmainu-container")!;
}

function getLapas(datums: string): string[][] {
    if (!dati) return [];

    const klases = klasesArIzmainam(dati, datums);
    const lapas: string[][] = [];
    for (let i = 0; i < klases.length; i += RINDAS_LAPA) lapas.push(klases.slice(i, i + RINDAS_LAPA));
    return lapas;
}

function createRow(d: IzmainuDati, datums: string, klase: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "class-holder";
    row.dataset.klase = klase;

    const holder = document.createElement("div");
    holder.className = "izmainu-holder";
    for (let i = 0; i < d.stunduSkaits; i++) holder.append(createClassContainer(d, datums, klase, i));

    row.append(createClassNumber(klase), holder);
    return row;
}

function renderLapa(klases: string[], datums: string): void {
    const container = getContainer();

    if (!dati || klases.length === 0) {
        const tuksas = document.createElement("p");
        tuksas.className = "izmainas-tuksas";
        tuksas.textContent = "Izmaiņu nav :-)";
        container.replaceChildren(tuksas);
        return;
    }

    const d = dati;
    container.replaceChildren(...klases.map(k => createRow(d, datums, k)));
}

let raditais = "";   // kas šobrīd uzzīmēts — lai nepārzīmētu to pašu
let animacija = false;  // vai šobrīd notiek fade
let kadrs: number | undefined;

/** Ko lapa rāda (klases + to stundas). Ja tas nav mainījies, pārzīmēt nevajag. */
function lapasAtslega(klases: string[], datums: string): string {
    const d = dati;
    if (!d || klases.length === 0) return "";
    return `${datums}#` + klases.map(k => {
        const rinda: string[] = [];
        for (let i = 0; i < d.stunduSkaits; i++) {
            const { stunda, mainita } = getStunda(d, datums, k, i);
            rinda.push(`${mainita ? "!" : ""}${stunda?.nosaukums ?? ""}/${stunda?.kabinets ?? ""}`);
        }
        return `${k}:${rinda.join(";")}`;
    }).join("|");
}

function currentKey(): string {
    const sodien = todayKey();
    const lapas = getLapas(sodien);
    return lapasAtslega(lapas[Math.min(lapa, Math.max(0, lapas.length - 1))] ?? [], sodien);
}

function showCurrent(): void {
    const sodien = todayKey();
    const lapas = getLapas(sodien);
    if (lapa >= lapas.length) lapa = 0;
    const klases = lapas[lapa] ?? [];
    raditais = lapasAtslega(klases, sodien);
    renderLapa(klases, sodien);
}

/**
 * Pāriet uz nākamo lapu (vai, ja advance=false, pārzīmē esošo ar jaunajiem datiem).
 * Ja saturs nemainās, neko nedara — nav lieka fade, ja ir tikai viena lapa.
 */
function rotate(advance = true): void {
    rotacijasTaimeris = undefined;
    const sodien = todayKey();
    const lapas = getLapas(sodien);
    const nakama = advance && lapas.length > 1 ? (lapa + 1) % lapas.length : Math.min(lapa, Math.max(0, lapas.length - 1));

    if (lapasAtslega(lapas[nakama] ?? [], sodien) === raditais) {
        rotacijasTaimeris = window.setTimeout(rotate, ROTACIJA_MS);
        return;
    }

    lapa = nakama;
    animacija = true;
    const container = getContainer();
    container.classList.add("fade-out");

    // + 50ms rezerve, lai saturu mainām tikai tad, kad tas jau ir pilnīgi caurspīdīgs
    rotacijasTaimeris = window.setTimeout(() => {
        rotacijasTaimeris = undefined;
        showCurrent();
        // Divi kadri: pirmajā pārlūks uzzīmē jauno saturu, otrajā sākas fade-in.
        // Ja abus dara vienā kadrā, tas kadrs nokavējas un animācija noraustās.
        kadrs = requestAnimationFrame(() => {
            kadrs = requestAnimationFrame(() => {
                kadrs = undefined;
                container.classList.remove("fade-out");
                animacija = false;
                if (started) rotacijasTaimeris = window.setTimeout(rotate, ROTACIJA_MS);
            });
        });
    }, FADE_MS + 50);
}

/** Jauni dati: parādām tos ar fade (ne ar lēcienu). Ja fade jau notiek — tas paņems jaunos datus pats. */
function kick(): void {
    if (animacija || !started) return;
    if (currentKey() === raditais) return; // šī lapa nav mainījusies — lai turpina kā bija
    clearTimeout(rotacijasTaimeris);
    rotate(false);
}

function setUpdateTime(): void {
    document.getElementById("update-time")!.textContent = dati ? formatAtjaunots(dati.atjaunots[todayKey()] ?? 0) : "-";
}

async function poll(): Promise<void> {
    pollTaimeris = undefined;
    try {
        const jauni = await withTimeout(REQUEST_TIMEOUT_MS, signal => loadIzmainas(signal));
        if (!dati || jauni.version !== dati.version) {
            dati = jauni;
            kick();
        }
    } catch (err) {
        console.error(err);
    } finally {
        setUpdateTime();
        if (started) pollTaimeris = window.setTimeout(poll, POLL_MS);
    }
}

export function startIzmainas(): void {
    if (started) return;
    started = true;
    showCurrent(); // "Izmaiņu nav", līdz atnāk dati
    void poll();
    rotacijasTaimeris = window.setTimeout(rotate, ROTACIJA_MS);
}

export function stopIzmainas(): void {
    started = false;
    animacija = false;
    clearTimeout(rotacijasTaimeris);
    clearTimeout(pollTaimeris);
    if (kadrs !== undefined) cancelAnimationFrame(kadrs);
    kadrs = undefined;
    rotacijasTaimeris = undefined;
    pollTaimeris = undefined;
}
