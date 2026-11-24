// Kopīgais modulis: datu tipi, API izsaukumi un šūnu zīmēšana.
// To izmanto gan TV lapa (izmainas.ts), gan vadības lapa (dashboard.ts).
export const REKLAMU_URL = "/api/reklamas";
export const PARKLAJUMU_URL = "/api/parklajumi";
export const PRIEKSSKATS_ZINA = "tema-prieksskats";
export function parklajumaUrl(id) {
    return `${PARKLAJUMU_URL}/${encodeURIComponent(id)}`;
}
export function reklamaUrl(id) {
    return `${REKLAMU_URL}/${encodeURIComponent(id)}`;
}
/** Cik dienas atpakaļ glabā izmaiņas (= GLABA_DIENAS server.mjs) */
export const GLABA_DIENAS = 31;
export const DIENAS = ["Svētdiena", "Pirmdiena", "Otrdiena", "Trešdiena", "Ceturtdiena", "Piektdiena", "Sestdiena"];
export const API_URL = "/api/izmainas";
export class KonfliktaKluda extends Error {
    dati;
    constructor(dati) {
        super("Dati tika mainīti citur");
        this.dati = dati;
    }
}
export async function loadIzmainas(signal) {
    // no-cache + serveris sūta ETag -> ja nekas nav mainījies, pārlūks saņem tikai 304
    const res = await fetch(API_URL, { cache: "no-cache", signal: signal ?? null });
    if (!res.ok)
        throw new Error(`Neizdevās ielādēt izmaiņas: ${res.status}`);
    return await res.json();
}
export async function saveIzmainas(dati, signal) {
    const res = await fetch(API_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dati),
        signal: signal ?? null,
    });
    if (res.status === 409)
        throw new KonfliktaKluda(await res.json());
    if (!res.ok)
        throw new Error(`Neizdevās saglabāt: ${res.status}`);
    return await res.json();
}
/** fetch ar noildzi — taimeris vienmēr tiek notīrīts */
export async function withTimeout(ms, fn) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fn(ctrl.signal);
    }
    finally {
        clearTimeout(timer);
    }
}
// ---------- Palīgfunkcijas ----------
const hasOwn = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
/** Datums kā "YYYY-MM-DD" (vietējā laikā) — tā glabā datus un <input type="date">. */
export function todayKey(date = new Date()) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${d}`;
}
export function parseDatums(datums) {
    const [y, m, d] = datums.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
/** "2026-11-23" -> "1" (pirmdiena). Atslēga pamatplānā. */
export function weekdayOf(datums) {
    return String(parseDatums(datums).getDay());
}
export function addDays(datums, n) {
    const d = parseDatums(datums);
    d.setDate(d.getDate() + n);
    return todayKey(d);
}
/** "2026-11-23" -> "23/11/2026" */
export function formatDatums(datums) {
    const [y, m, d] = datums.split("-");
    return `${d}/${m}/${y}`;
}
export function parseKlase(nosaukums) {
    const m = /^(\d{1,2})\.(\p{L}{1,3})$/u.exec(nosaukums.trim());
    if (!m || !m[1] || !m[2])
        return null;
    return { grade: Number(m[1]), letter: m[2].toLowerCase() };
}
export function sortKlases(klases) {
    return [...klases].sort((a, b) => {
        const ka = parseKlase(a);
        const kb = parseKlase(b);
        if (!ka || !kb)
            return a.localeCompare(b, "lv");
        return ka.grade - kb.grade || ka.letter.localeCompare(kb.letter, "lv");
    });
}
export function sameStunda(a, b) {
    if (!a || !b)
        return (a ?? null) === (b ?? null);
    return a.nosaukums === b.nosaukums && a.kabinets === b.kabinets;
}
export function stundaText(s) {
    if (!s)
        return "nav stundas";
    return s.kabinets ? `${s.nosaukums} ${s.kabinets}` : s.nosaukums;
}
/** Pastāvīgā stunda tajā nedēļas dienā, kurā ir šis datums. */
export function getBase(dati, datums, klase, i) {
    return dati.pamatplans[weekdayOf(datums)]?.[klase]?.[i] ?? null;
}
export function hasIzmaina(dati, datums, klase, i) {
    const o = dati.izmainas[datums]?.[klase];
    return !!o && hasOwn(o, String(i));
}
/** Stunda, kas notiek šajā datumā: izmaiņa, ja tāda ir, citādi pamatplāns. */
export function getStunda(dati, datums, klase, i) {
    const o = dati.izmainas[datums]?.[klase];
    if (o && hasOwn(o, String(i)))
        return { stunda: o[String(i)] ?? null, mainita: true };
    return { stunda: getBase(dati, datums, klase, i), mainita: false };
}
export function klasesArIzmainam(dati, datums) {
    const dienas = dati.izmainas[datums];
    if (!dienas)
        return [];
    return sortKlases(dati.klases).filter(k => Object.keys(dienas[k] ?? {}).length > 0);
}
export function formatAtjaunots(ms, now = Date.now()) {
    if (!ms)
        return "-";
    const min = Math.max(0, Math.floor((now - ms) / 60_000));
    if (min < 1)
        return "Tikko";
    if (min < 60)
        return `Pirms ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24)
        return `Pirms ${h} h`;
    return new Date(ms).toLocaleDateString("lv-LV");
}
// ---------- Zīmēšana (tikai textContent — nekāds HTML no datiem) ----------
export function createClassNumber(klase) {
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
export function createClassContainer(dati, datums, klase, i, skats = "izmainas") {
    const cell = document.createElement("div");
    cell.className = "class-container";
    cell.dataset.time = String(i + 1);
    let stunda;
    if (skats === "izmainas") {
        const s = getStunda(dati, datums, klase, i);
        stunda = s.stunda;
        if (s.mainita) {
            cell.classList.add("changed");
            cell.title = `Pamatplānā: ${stundaText(getBase(dati, datums, klase, i))}`;
        }
    }
    else {
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
//# sourceMappingURL=izmainas-dati.js.map