// Kopīgais modulis: datu tipi, API izsaukumi un šūnu zīmēšana.
// To izmanto gan TV lapa (izmainas.ts), gan vadības lapa (dashboard.ts).

export interface Stunda {
    nosaukums: string;
    kabinets: string;
}

/** null = šajā laikā stundas nav */
export type Ieraksts = Stunda | null;

/** klase -> { stundas indekss (no 0): jaunā stunda } */
export type DienasIzmainas = Record<string, Record<string, Ieraksts>>;

export interface IzmainuDati {
    version: number;
    /** Kad pēdējo reizi mainījās katra datuma izmaiņas: "2026-11-23" -> ms ("Atjaunināts: Pirms N min") */
    atjaunots: Record<string, number>;
    stunduSkaits: number;
    /** "7.a", "12.g" ... */
    klases: string[];
    /** Stundu saraksts izvēlei (katalogs) */
    stundas: Stunda[];
    /** Pastāvīgais plāns katrai nedēļas dienai: "1" (pirmdiena) … "6", "0" (svētdiena) -> klase -> stundas */
    pamatplans: Record<string, Record<string, Ieraksts[]>>;
    /** Pagaidu izmaiņas katram datumam: "2026-11-23" -> klase -> stundas. Pagājušos datumus serveris izdzēš. */
    izmainas: Record<string, DienasIzmainas>;
}

/** Cik dienas atpakaļ glabā izmaiņas (= GLABA_DIENAS server.mjs) */
export const GLABA_DIENAS = 31;

export const DIENAS = ["Svētdiena", "Pirmdiena", "Otrdiena", "Trešdiena", "Ceturtdiena", "Piektdiena", "Sestdiena"];

export const API_URL = "/api/izmainas";

export class KonfliktaKluda extends Error {
    readonly dati: IzmainuDati;
    constructor(dati: IzmainuDati) {
        super("Dati tika mainīti citur");
        this.dati = dati;
    }
}

export async function loadIzmainas(signal?: AbortSignal): Promise<IzmainuDati> {
    // no-cache + serveris sūta ETag -> ja nekas nav mainījies, pārlūks saņem tikai 304
    const res = await fetch(API_URL, { cache: "no-cache", signal: signal ?? null });
    if (!res.ok) throw new Error(`Neizdevās ielādēt izmaiņas: ${res.status}`);
    return await res.json() as IzmainuDati;
}

export async function saveIzmainas(dati: IzmainuDati, signal?: AbortSignal): Promise<IzmainuDati> {
    const res = await fetch(API_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dati),
        signal: signal ?? null,
    });
    if (res.status === 409) throw new KonfliktaKluda(await res.json() as IzmainuDati);
    if (!res.ok) throw new Error(`Neizdevās saglabāt: ${res.status}`);
    return await res.json() as IzmainuDati;
}

/** fetch ar noildzi — taimeris vienmēr tiek notīrīts */
export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fn(ctrl.signal);
    } finally {
        clearTimeout(timer);
    }
}

// ---------- Palīgfunkcijas ----------

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** Datums kā "YYYY-MM-DD" (vietējā laikā) — tā glabā datus un <input type="date">. */
export function todayKey(date: Date = new Date()): string {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${d}`;
}

export function parseDatums(datums: string): Date {
    const [y, m, d] = datums.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** "2026-11-23" -> "1" (pirmdiena). Atslēga pamatplānā. */
export function weekdayOf(datums: string): string {
    return String(parseDatums(datums).getDay());
}

export function addDays(datums: string, n: number): string {
    const d = parseDatums(datums);
    d.setDate(d.getDate() + n);
    return todayKey(d);
}

/** "2026-11-23" -> "23/11/2026" */
export function formatDatums(datums: string): string {
    const [y, m, d] = datums.split("-");
    return `${d}/${m}/${y}`;
}

export function parseKlase(nosaukums: string): { grade: number; letter: string } | null {
    const m = /^(\d{1,2})\.(\p{L}{1,3})$/u.exec(nosaukums.trim());
    if (!m || !m[1] || !m[2]) return null;
    return { grade: Number(m[1]), letter: m[2].toLowerCase() };
}

export function sortKlases(klases: string[]): string[] {
    return [...klases].sort((a, b) => {
        const ka = parseKlase(a);
        const kb = parseKlase(b);
        if (!ka || !kb) return a.localeCompare(b, "lv");
        return ka.grade - kb.grade || ka.letter.localeCompare(kb.letter, "lv");
    });
}

export function sameStunda(a: Ieraksts | undefined, b: Ieraksts | undefined): boolean {
    if (!a || !b) return (a ?? null) === (b ?? null);
    return a.nosaukums === b.nosaukums && a.kabinets === b.kabinets;
}

export function stundaText(s: Ieraksts): string {
    if (!s) return "nav stundas";
    return s.kabinets ? `${s.nosaukums} ${s.kabinets}` : s.nosaukums;
}

/** Pastāvīgā stunda tajā nedēļas dienā, kurā ir šis datums. */
export function getBase(dati: IzmainuDati, datums: string, klase: string, i: number): Ieraksts {
    return dati.pamatplans[weekdayOf(datums)]?.[klase]?.[i] ?? null;
}

export function hasIzmaina(dati: IzmainuDati, datums: string, klase: string, i: number): boolean {
    const o = dati.izmainas[datums]?.[klase];
    return !!o && hasOwn(o, String(i));
}

/** Stunda, kas notiek šajā datumā: izmaiņa, ja tāda ir, citādi pamatplāns. */
export function getStunda(dati: IzmainuDati, datums: string, klase: string, i: number): { stunda: Ieraksts; mainita: boolean } {
    const o = dati.izmainas[datums]?.[klase];
    if (o && hasOwn(o, String(i))) return { stunda: o[String(i)] ?? null, mainita: true };
    return { stunda: getBase(dati, datums, klase, i), mainita: false };
}

export function klasesArIzmainam(dati: IzmainuDati, datums: string): string[] {
    const dienas = dati.izmainas[datums];
    if (!dienas) return [];
    return sortKlases(dati.klases).filter(k => Object.keys(dienas[k] ?? {}).length > 0);
}

export function formatAtjaunots(ms: number, now: number = Date.now()): string {
    if (!ms) return "-";
    const min = Math.max(0, Math.floor((now - ms) / 60_000));
    if (min < 1) return "Tikko";
    if (min < 60) return `Pirms ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Pirms ${h} h`;
    return new Date(ms).toLocaleDateString("lv-LV");
}

// ---------- Zīmēšana (tikai textContent — nekāds HTML no datiem) ----------

export function createClassNumber(klase: string): HTMLDivElement {
    const box = document.createElement("div");
    box.className = "class-number";
    const h2 = document.createElement("h2");
    h2.className = "class";
    h2.textContent = klase;
    box.append(h2);
    return box;
}

/**
 * skats "izmainas" — rāda stundu šajā datumā (izmaiņas sarkanā rāmī);
 * skats "pamatplans" — rāda pastāvīgo plānu (izmantots dashboard).
 */
export function createClassContainer(
    dati: IzmainuDati,
    datums: string,
    klase: string,
    i: number,
    skats: "izmainas" | "pamatplans" = "izmainas",
): HTMLDivElement {
    const cell = document.createElement("div");
    cell.className = "class-container";
    cell.dataset.time = String(i + 1);

    let stunda: Ieraksts;
    if (skats === "izmainas") {
        const s = getStunda(dati, datums, klase, i);
        stunda = s.stunda;
        if (s.mainita) {
            cell.classList.add("changed");
            cell.title = `Pamatplānā: ${stundaText(getBase(dati, datums, klase, i))}`;
        }
    } else {
        stunda = getBase(dati, datums, klase, i);
        cell.classList.add("base");
        if (hasIzmaina(dati, datums, klase, i)) {
            cell.classList.add("has-override");
            cell.title = `Izmaiņa: ${stundaText(getStunda(dati, datums, klase, i).stunda)}`;
        }
    }

    const type = document.createElement("p");
    type.className = "class-type";
    type.textContent = stunda?.nosaukums ?? "";

    const kabinets = document.createElement("p");
    kabinets.className = "kabinets";
    kabinets.textContent = stunda?.kabinets ?? "";

    cell.append(type, kabinets);
    return cell;
}
