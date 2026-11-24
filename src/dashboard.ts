import {
    type Ieraksts,
    type IzmainuDati,
    type Stunda,
    KonfliktaKluda,
    createClassContainer,
    getBase,
    getStunda,
    hasIzmaina,
    loadIzmainas,
    parseKlase,
    sameStunda,
    saveIzmainas,
    sortKlases,
    stundaText,
    DIENAS,
    GLABA_DIENAS,
    addDays,
    formatDatums,
    REKLAMU_URL,
    reklamaUrl,
    type Reklamas,
    PARKLAJUMU_URL,
    PRIEKSSKATS_ZINA,
    type Tema,
    todayKey,
    weekdayOf,
    withTimeout,
} from "./izmainas-dati.js";


type Rezims = "izmainas" | "pamatplans";
type AtlasesVeids = "suna" | "klase" | "grade" | "kolonna" | "visas";
type Izvele = "keep" | "none" | Stunda;

interface Suna {
    klase: string;
    i: number;
}

const POLL_MS = 15_000;
const RETRY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;

let dati: IzmainuDati | null = null;
/** Kuru dienu dashboard rāda: izmaiņas šim datumam + šīs nedēļas dienas pamatplāns. */
let skatsDatums = todayKey();

const atlase = new Set<string>();
let atlasesRezims: Rezims = "izmainas";

const picker = {
    rezims: "izmainas" as Rezims,
    merki: [] as Suna[],
    izvele: "keep" as Izvele,
    kabinetsMainits: false,
    sakumaKabinets: "",
    saraksts: [] as Stunda[],
};

let saglaba = false;
let vajagSaglabat = false;
let pollTaimeris: number | undefined;
let retryTaimeris: number | undefined;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
}

const sunaKey = (klase: string, i: number): string => `${klase}|${i}`;

function parseSunaKey(key: string): Suna {
    const p = key.lastIndexOf("|");
    return { klase: key.slice(0, p), i: Number(key.slice(p + 1)) };
}

const stunduVards = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? "stunda" : "stundas");

const gradeOf = (klase: string): number => parseKlase(klase)?.grade ?? 0;

function range(): number[] {
    return Array.from({ length: dati?.stunduSkaits ?? 0 }, (_, i) => i);
}

function visibleKlases(): string[] {
    return dati ? sortKlases(dati.klases) : [];
}

function setStatus(text: string, kluda = false): void {
    const p = $("statuss");
    p.textContent = text;
    p.classList.toggle("kluda", kluda);
}

function laiks(): string {
    return new Date().toLocaleTimeString("lv-LV", { hour: "2-digit", minute: "2-digit" });
}

// Datu izmaiņa

function setIzmaina(klase: string, i: number, next: Ieraksts): void {
    const d = dati!;
    const diena = d.izmainas[skatsDatums] ?? {};
    const o = diena[klase] ?? {};
    //le compaareee
    if (sameStunda(next, getBase(d, skatsDatums, klase, i))) delete o[String(i)];
    else o[String(i)] = next;

    if (Object.keys(o).length > 0) diena[klase] = o;
    else delete diena[klase];

    if (Object.keys(diena).length > 0) d.izmainas[skatsDatums] = diena;
    else delete d.izmainas[skatsDatums];
}

function removeIzmaina(klase: string, i: number): void {
    const diena = dati!.izmainas[skatsDatums];
    const o = diena?.[klase];
    if (!diena || !o) return;
    delete o[String(i)];
    if (Object.keys(o).length === 0) delete diena[klase];
    if (Object.keys(diena).length === 0) delete dati!.izmainas[skatsDatums];
}

function setPamatplans(klase: string, i: number, next: Ieraksts): void {
    const d = dati!;
    // Maina visas šīs nedēļas dienas (piem. visas pirmdienas)
    const diena = d.pamatplans[weekdayOf(skatsDatums)] ?? {};
    const rinda = Array.from({ length: d.stunduSkaits }, (_, j) => diena[klase]?.[j] ?? null);
    rinda[i] = next;
    diena[klase] = rinda;
    d.pamatplans[weekdayOf(skatsDatums)] = diena;

    if (hasIzmaina(d, skatsDatums, klase, i) && sameStunda(getStunda(d, skatsDatums, klase, i).stunda, next)) removeIzmaina(klase, i);
}

/** Pirmā stunda ar šo nosaukumu klases izmaiņās konkrētā datumā (vai null). */
function izmainasKabinets(datums: string, klase: string, nosaukums: string): string | null {
    for (const st of Object.values(dati!.izmainas[datums]?.[klase] ?? {})) {
        if (st?.nosaukums === nosaukums) return st.kabinets;
    }
    return null;
}

/**
 * Kabinets, kurā šai klasei notiek šī stunda. Secība:
 *   1. šīs dienas izmaiņās šai klasei jau ielikts kabinets (tikai Izmaiņu tabulā)
 *   2. klases stundu saraksts — tā pati nedēļas diena, tad citas dienas
 *   3. klases jaunākās izmaiņas citos datumos (tikai Izmaiņu tabulā)
 * Stundu sarakstu (pastāvīgo) pagaidu izmaiņas neietekmē. null — klasei šīs stundas nav.
 */
function klasesKabinets(klase: string, nosaukums: string): string | null {
    const d = dati!;
    const izmainuTabula = picker.rezims === "izmainas";

    if (izmainuTabula) {
        const sodien = izmainasKabinets(skatsDatums, klase, nosaukums);
        if (sodien !== null) return sodien;
    }

    const diena = weekdayOf(skatsDatums);
    const skaits = new Map<string, number>();
    for (const [dienasNr, plans] of Object.entries(d.pamatplans)) {
        for (const st of plans[klase] ?? []) {
            if (st?.nosaukums !== nosaukums) continue;
            skaits.set(st.kabinets, (skaits.get(st.kabinets) ?? 0) + (dienasNr === diena ? 100 : 1));
        }
    }
    let labakais: string | null = null;
    let max = 0;
    for (const [kab, n] of skaits) if (n > max) [labakais, max] = [kab, n];
    if (labakais !== null) return labakais;

    if (izmainuTabula) {
        for (const datums of Object.keys(d.izmainas).sort().reverse()) {
            if (datums === skatsDatums) continue;
            const kab = izmainasKabinets(datums, klase, nosaukums);
            if (kab !== null) return kab;
        }
    }
    return null;
}

/** Kabinets, ko dot šai šūnai, ja izvēlēta stunda st un kabinets nav ierakstīts ar roku. */
function kabinetsFor(s: Suna, st: Stunda): string {
    // Ja sarakstā ir vairākas stundas ar šo nosaukumu (piem. "Fizika 134" un "Fizika 201"),
    // izvēlētais variants ir apzināta kabineta izvēle.
    if (dati!.stundas.filter(x => x.nosaukums === st.nosaukums).length > 1) return st.kabinets;
    return klasesKabinets(s.klase, st.nosaukums) ?? st.kabinets;
}

/** Ko rādīt sarakstā blakus stundai: kabinets(-i), ko tā dabūs atlasītajām klasēm. */
function kabinetsRadit(st: Stunda): string {
    const klases = [...new Map(picker.merki.map(m => [m.klase, m])).values()]; // viena šūna no katras klases
    const kabineti = [...new Set(klases.map(m => kabinetsFor(m, st)))].filter(Boolean);
    return kabineti.length > 3 ? `${kabineti.slice(0, 3).join(" / ")} …` : kabineti.join(" / ");
}

function addStunda(s: Stunda): Stunda {
    const d = dati!;
    const esosa = d.stundas.find(x => sameStunda(x, s));
    if (esosa) return esosa;
    d.stundas.push(s);
    d.stundas.sort((a, b) => a.nosaukums.localeCompare(b.nosaukums, "lv") || a.kabinets.localeCompare(b.kabinets, "lv"));
    return s;
}

function pruneAtlase(): void {
    if (!dati) return;
    const d = dati;
    for (const key of atlase) {
        const { klase, i } = parseSunaKey(key);
        if (!d.klases.includes(klase) || i >= d.stunduSkaits) atlase.delete(key);
    }
}

/**
 * Vai serveris sūta jauno datu formu (pamatplāns pa nedēļas dienām).
 * Ja server.mjs pēc atjaunināšanas nav restartēts, tas sūta veco formu — un, ja tam
 * saglabātu jauno, tas izdzēstu stundu sarakstu. Tādā gadījumā nesaglabājam neko.
 */
function isJaunaForma(d: IzmainuDati): boolean {
    return typeof d.atjaunots === "object" && !!d.pamatplans && "1" in d.pamatplans;
}

const VECS_SERVERIS = "Serveris darbojas ar veco versiju — aizver to un palaid server.mjs no jauna, tad pārlādē lapu.";

/** Datu saturs bez versijas un laikiem, ar sakārtotām atslēgām — lai salīdzinātu. */
function saturs(d: IzmainuDati): string {
    return JSON.stringify([d.stunduSkaits, d.klases, d.stundas, d.pamatplans, d.izmainas, d.reklamas, d.tema], (_k, v: unknown) =>
        v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
            : v);
}

function commit(): void {
    queueSave(); // vispirms saglabā — lai zīmēšanas kļūda nekad neaptur saglabāšanu
    renderAll();
}


function queueSave(): void {
    vajagSaglabat = true;
    clearTimeout(retryTaimeris);
    retryTaimeris = undefined;
    if (!saglaba) void flush();
}

async function flush(): Promise<void> {
    saglaba = true;
    setStatus("Saglabā…");
    try {
        while (vajagSaglabat && dati) {
            vajagSaglabat = false;
            const d = dati;
            const nosutits = saturs(d);
            const saved = await withTimeout(REQUEST_TIMEOUT_MS, signal => saveIzmainas(d, signal));
            if (vajagSaglabat && dati) {
                dati.version = saved.version;
                dati.atjaunots = saved.atjaunots;
            } else {
                dati = saved;
                pruneAtlase();
                // Parasti serveris atdod tieši to pašu — tad pārzīmēt nav vajadzības
                if (saturs(saved) !== nosutits) renderAll();
            }
        }
        setStatus(`Saglabāts ${laiks()}`);
    } catch (err) {
        if (err instanceof KonfliktaKluda) {
            vajagSaglabat = false;
            dati = err.dati;
            pruneAtlase();
            renderAll();
            setStatus("!", true);
        } else {
            console.error(err);
            vajagSaglabat = true;
            setStatus("Neizdevās saglabāt :(", true);
            clearTimeout(retryTaimeris);
            retryTaimeris = window.setTimeout(() => {
                retryTaimeris = undefined;
                if (!saglaba && vajagSaglabat) void flush();
            }, RETRY_MS);
        }
    } finally {
        saglaba = false;
    }
}

async function poll(): Promise<void> {
    pollTaimeris = undefined;
    if (!saglaba && !vajagSaglabat) {
        try {
            const jauni = await withTimeout(REQUEST_TIMEOUT_MS, signal => loadIzmainas(signal));
            if (!isJaunaForma(jauni)) {
                dati = null; // nekas nav rediģējams, tātad nekas netiks saglabāts
                renderAll();
                setStatus(VECS_SERVERIS, true);
                pollTaimeris = window.setTimeout(poll, RETRY_MS);
                return;
            }
            if (skatsDatums < oldestKey()) setSkatsDatums(todayKey()); // pēc pusnakts, ja diena izkrita no vēstures
            if (!saglaba && !vajagSaglabat && (!dati || jauni.version > dati.version)) {
                const pirmais = !dati;
                dati = jauni;
                pruneAtlase();
                renderAll();
                if (pirmais) setStatus("Dati ielādēti");
            }
        } catch (err) {
            console.error(err);
            if (!dati) setStatus("Neizdevās ielādēt datus...", true);
        }
    }
    pollTaimeris = window.setTimeout(poll, dati ? POLL_MS : RETRY_MS);
}


function keysFor(veids: AtlasesVeids, opts: { klase?: string; grade?: number; i?: number }): string[] {
    const klases = visibleKlases();
    const r = range();
    switch (veids) {
        case "suna":
            return opts.klase !== undefined && opts.i !== undefined ? [sunaKey(opts.klase, opts.i)] : [];
        case "klase":
            return opts.klase !== undefined ? r.map(i => sunaKey(opts.klase!, i)) : [];
        case "grade":
            return klases.filter(k => gradeOf(k) === opts.grade).flatMap(k => r.map(i => sunaKey(k, i)));
        case "kolonna":
            return klases.map(k => sunaKey(k, opts.i ?? 0));
        case "visas":
            return klases.flatMap(k => r.map(i => sunaKey(k, i)));
    }
}

function createCheck(
    veids: AtlasesVeids,
    opts: { klase?: string; grade?: number; i?: number },
    sel: ReadonlySet<string>,
    label: string,
    keys: string[] = keysFor(veids, opts), // renderGrid padod jau sagatavotus — tā ir daudz ātrāk
): HTMLInputElement {
    const cb = el("input", "atlase-check");
    cb.type = "checkbox";
    cb.dataset.atlase = veids;
    if (opts.klase !== undefined) cb.dataset.klase = opts.klase;
    if (opts.grade !== undefined) cb.dataset.grade = String(opts.grade);
    if (opts.i !== undefined) cb.dataset.i = String(opts.i);
    cb.setAttribute("aria-label", label);

    let n = 0;
    for (const k of keys) if (sel.has(k)) n++;
    cb.checked = keys.length > 0 && n === keys.length;
    cb.indeterminate = n > 0 && n < keys.length;
    return cb;
}

const TUKSA_ATLASE: ReadonlySet<string> = new Set();

function renderGrid(rezims: Rezims): void {
    const root = $(rezims === "izmainas" ? "izmainas-grid" : "pamatplans-grid");
    if (!dati) {
        root.replaceChildren(el("p", "izmainas-tuksas", "..."));
        return;
    }

    const d = dati;
    const klases = visibleKlases();
    const sel = atlasesRezims === rezims ? atlase : TUKSA_ATLASE;
    root.classList.toggle("has-selection", sel.size > 0);

    if (klases.length === 0) {
        root.replaceChildren(el("p", "izmainas-tuksas", "Nav klašu"));
        return;
    }

    // Atslēgas aprēķinām vienreiz visai tabulai (nevis katrai rūtiņai no jauna)
    const r = range();
    const rindasAtslegas = new Map(klases.map(k => [k, r.map(i => sunaKey(k, i))]));
    const visas = klases.flatMap(k => rindasAtslegas.get(k)!);

    const header = el("div", "table-header");
    const stura = el("label", "class-number");
    stura.append(createCheck("visas", {}, sel, "Atlasīt visu", visas));
    const kolonnas = el("div", "izmainu-holder");
    for (const i of r) {
        const kol = el("label", "kolonna");
        kol.append(createCheck("kolonna", { i }, sel, `Atlasīt ${i + 1}. stundu visām klasēm`, klases.map(k => sunaKey(k, i))),
            el("span", "", `${i + 1}.`));
        kolonnas.append(kol);
    }
    header.append(stura, kolonnas);

    const nodes: HTMLElement[] = [header];
    let pedejaisGrade: number | null = null;

    for (const k of klases) {
        const g = gradeOf(k);
        if (g !== pedejaisGrade) {
            pedejaisGrade = g;
            const gh = el("label", "grade-header");
            const gradeAtslegas = klases.filter(x => gradeOf(x) === g).flatMap(x => rindasAtslegas.get(x)!);
            gh.append(createCheck("grade", { grade: g }, sel, `Atlasīt ${g}. klases`, gradeAtslegas), el("h2", "", `${g}. klases`));
            nodes.push(gh);
        }

        const row = el("div", "class-holder");
        row.dataset.klase = k;

        const num = el("label", "class-number");
        num.append(createCheck("klase", { klase: k }, sel, `Atlasīt ${k} visas stundas`, rindasAtslegas.get(k)!), el("h2", "class", k));
        if (rezims === "pamatplans") {
            const x = el("button", "nonemt", "×");
            x.type = "button";
            x.dataset.nonemtKlase = k;
            x.title = `Dzēst klasi ${k}`;
            num.append(x);
        }

        const holder = el("div", "izmainu-holder");
        for (const i of r) {
            const key = sunaKey(k, i);
            const cell = createClassContainer(d, skatsDatums, k, i, rezims);
            cell.dataset.klase = k;
            cell.tabIndex = 0;
            cell.setAttribute("role", "button");
            if (sel.has(key)) cell.classList.add("selected");
            // Lielāks laukums ap rūtiņu, lai to ir viegli trāpīt
            const zona = el("label", "atlase-zona");
            zona.append(createCheck("suna", { klase: k, i }, sel, `Atlasīt ${k} ${i + 1}. stundu`, [key]));
            cell.prepend(zona);
            holder.append(cell);
        }

        row.append(num, holder);
        nodes.push(row);
    }

    root.replaceChildren(...nodes);
}

function onGridChange(e: Event): void {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains("atlase-check")) return;
    const root = e.currentTarget as HTMLElement;
    const rezims = root.dataset.rezims as Rezims;

    if (rezims !== atlasesRezims) {
        atlase.clear();
        atlasesRezims = rezims;
    }

    const opts: { klase?: string; grade?: number; i?: number } = {};
    if (t.dataset.klase !== undefined) opts.klase = t.dataset.klase;
    if (t.dataset.grade !== undefined) opts.grade = Number(t.dataset.grade);
    if (t.dataset.i !== undefined) opts.i = Number(t.dataset.i);

    for (const key of keysFor(t.dataset.atlase as AtlasesVeids, opts)) {
        if (t.checked) atlase.add(key);
        else atlase.delete(key);
    }
    renderGrids();
    renderAtlase();
}

function cellFromEvent(e: Event): { rezims: Rezims; suna: Suna } | null {
    const t = e.target as HTMLElement;
    if (t.closest("input, label")) return null; // tā ir atlases rūtiņa
    const cell = t.closest<HTMLElement>(".class-container");
    if (!cell || cell.dataset.klase === undefined || cell.dataset.time === undefined) return null;
    return {
        rezims: (e.currentTarget as HTMLElement).dataset.rezims as Rezims,
        suna: { klase: cell.dataset.klase, i: Number(cell.dataset.time) - 1 },
    };
}

function removeKlase(k: string): void {
    if (!dati || !confirm(`Dzēst klasi ${k}? Tiks dzēsts arī tās stundu saraksts un izmaiņas. Šo darbību nevar atsaukt!`)) return;
    dati.klases = dati.klases.filter(x => x !== k);
    for (const diena of Object.values(dati.pamatplans)) delete diena[k];
    for (const diena of Object.values(dati.izmainas)) delete diena[k];
    pruneAtlase();
    commit();
}

function onGridClick(e: MouseEvent): void {
    const x = (e.target as HTMLElement).closest<HTMLButtonElement>("button.nonemt");
    if (x?.dataset.nonemtKlase) {
        e.preventDefault();
        removeKlase(x.dataset.nonemtKlase);
        return;
    }
    const c = cellFromEvent(e);
    if (!c) return;
    if (e.ctrlKey || e.metaKey) {
        // Ctrl + klikšķis: atlasa/noņem šo stundu, neatverot logu
        if (c.rezims !== atlasesRezims) {
            atlase.clear();
            atlasesRezims = c.rezims;
        }
        const key = sunaKey(c.suna.klase, c.suna.i);
        if (atlase.has(key)) atlase.delete(key);
        else atlase.add(key);
        renderGrids();
        renderAtlase();
        return;
    }
    openPicker(c.rezims, [c.suna]);
}

function onGridKey(e: KeyboardEvent): void {
    if (e.key !== "Enter" && e.key !== " ") return;
    const c = cellFromEvent(e);
    if (!c) return;
    e.preventDefault();
    openPicker(c.rezims, [c.suna]);
}

function renderAtlase(): void {
    const n = atlase.size;
    const varNonemt = n > 0 && atlasesRezims === "izmainas" && [...atlase].some(key => {
        const s = parseSunaKey(key);
        return hasIzmaina(dati!, skatsDatums, s.klase, s.i);
    });

    for (const rezims of ["izmainas", "pamatplans"] as const) {
        const bar = $(`atlase-bar-${rezims}`);
        const redzams = n > 0 && atlasesRezims === rezims;
        bar.hidden = !redzams;
        if (!redzams) continue;
        bar.querySelector(".atlase-info")!.textContent = `${n === 1 ? "Atlasīta" : "Atlasītas"} ${n} ${stunduVards(n)}`;
        const nonemt = bar.querySelector<HTMLButtonElement>("[data-darbiba='nonemt']");
        if (nonemt) nonemt.disabled = !varNonemt;
    }
}

function renderDatums(): void {
    const sodien = todayKey();
    const diena = DIENAS[Number(weekdayOf(skatsDatums))] ?? "";

    $("datums-teksts").textContent = `${diena}, ${formatDatums(skatsDatums)}`;
    const input = $<HTMLInputElement>("datums");
    input.value = skatsDatums;
    input.min = oldestKey(); // vecākas dienas serveris izdzēš
    $<HTMLButtonElement>("datums-iepr").disabled = skatsDatums <= oldestKey();

    const pamatDiena = document.getElementById("pamatplans-diena");
    if (pamatDiena) pamatDiena.textContent = diena;

    // neobligāts paskaidrojums — var izņemt no HTML
    const info = document.getElementById("datums-info");
    if (info) {
        info.textContent = skatsDatums === sodien
            ? "TV šīs izmaiņas rāda šodien."
            : skatsDatums < sodien
                ? "Šī diena ir pagājusi — TV to vairs nerāda."
                : `TV šīs izmaiņas rādīs ${formatDatums(skatsDatums)}.`;
    }
}

/** Vecākais datums, uz kuru var aiziet (tik daudz serveris glabā). */
function oldestKey(): string {
    return addDays(todayKey(), -GLABA_DIENAS);
}

function setSkatsDatums(datums: string): void {
    const vecakais = oldestKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datums)) return;
    skatsDatums = datums < vecakais ? vecakais : datums;
    atlase.clear(); // atlase attiecas uz konkrēto dienu
    renderAll();
}

// Ja lapu pārzīmē starp peles nospiešanu un atlaišanu, pārlūks klikšķi "pazaudē"
// (nospiests uz viena elementa, atlaists uz cita). Tāpēc tad pārzīmēšanu atliekam.
let pelesPoga = false;
let atliktsRender = false;

function jaAtliek(): boolean {
    if (!pelesPoga) return false;
    atliktsRender = true;
    return true;
}

function pelesAtlaista(): void {
    pelesPoga = false;
    if (!atliktsRender) return;
    atliktsRender = false;
    setTimeout(renderAll, 0); // pēc klikšķa apstrādes
}

function renderGrids(): void {
    if (jaAtliek()) return;
    renderGrid("izmainas");
    renderGrid("pamatplans");
}

function renderAll(): void {
    if (jaAtliek()) return;
    renderReklamas();
    renderTema();
    renderGrids();
    renderAtlase();
    renderDatums();
}

function pickerCurrent(s: Suna): Ieraksts {
    return picker.rezims === "izmainas"
        ? getStunda(dati!, skatsDatums, s.klase, s.i).stunda
        : getBase(dati!, skatsDatums, s.klase, s.i);
}

function openPicker(rezims: Rezims, merki: Suna[]): void {
    if (!dati || merki.length === 0) return;
    const dialog = $<HTMLDialogElement>("picker");
    if (dialog.open) return;

    picker.rezims = rezims;
    picker.merki = merki;
    picker.izvele = "keep";
    picker.kabinetsMainits = false;

    const viens = merki.length === 1 ? merki[0]! : null;
    const diena = DIENAS[Number(weekdayOf(skatsDatums))] ?? "";
    const vieta = rezims === "pamatplans"
        ? ` · Stundu saraksts (katra ${diena.toLowerCase()})`
        : ` · ${formatDatums(skatsDatums)}`;
    $("picker-virsraksts").textContent = viens
        ? `${viens.klase} · ${viens.i + 1}. stunda${vieta}`
        : `Mainīt ${merki.length} ${stunduVards(merki.length)}${vieta}`;

    const info = $("picker-info");
    if (viens) {
        const bazes = getBase(dati, skatsDatums, viens.klase, viens.i);
        const tagad = getStunda(dati, skatsDatums, viens.klase, viens.i);
        info.textContent = rezims === "izmainas"
            ? `Stundu sarakstā: ${stundaText(bazes)}${tagad.mainita ? ` · Šobrīd (izmaina): ${stundaText(tagad.stunda)}` : ""}`
            : `Stundu sarakstā: ${stundaText(bazes)}${tagad.mainita ? ` · ${formatDatums(skatsDatums)} izmaina: ${stundaText(tagad.stunda)}` : ""}`;
    } else {
        const klases = [...new Set(merki.map(m => m.klase))];
        info.textContent = `Klases: ${klases.slice(0, 12).join(", ")}${klases.length > 12 ? " …" : ""}`;
    }

    const kab = $<HTMLInputElement>("picker-kabinets");
    picker.sakumaKabinets = viens ? (pickerCurrent(viens)?.kabinets ?? "") : "";
    kab.value = picker.sakumaKabinets;
    kab.placeholder = viens ? "" : "Atstāt esošo";
    kab.disabled = false;

    const nonemt = $<HTMLButtonElement>("picker-nonemt");
    nonemt.hidden = rezims !== "izmainas";
    nonemt.disabled = !merki.some(m => hasIzmaina(dati!, skatsDatums, m.klase, m.i));

    $<HTMLInputElement>("picker-meklet").value = "";
    $<HTMLInputElement>("jauna-nosaukums").value = "";
    $<HTMLInputElement>("jauna-kabinets").value = "";
    document.querySelector<HTMLDetailsElement>(".picker-jauna")!.open = false;
    renderPickerList();

    dialog.returnValue = ""; // citādi Esc atstātu iepriekšējo vērtību
    dialog.showModal();
    $<HTMLInputElement>("picker-meklet").focus();
}

function renderPickerList(): void {
    if (!dati) return;
    const q = $<HTMLInputElement>("picker-meklet").value.trim().toLocaleLowerCase("lv");
    picker.saraksts = dati.stundas.filter(s => !q
        || s.nosaukums.toLocaleLowerCase("lv").includes(q)
        || s.kabinets.toLocaleLowerCase("lv").includes(q));

    const viens = picker.merki.length === 1 ? picker.merki[0]! : null;
    const tagad = viens ? pickerCurrent(viens) : null;

    const opcija = (value: string, nosaukums: string, kabinets: string, checked: boolean, klase = ""): HTMLLabelElement => {
        const l = el("label", `picker-opcija ${klase}`.trim());
        const r = el("input");
        r.type = "radio";
        r.name = "stunda";
        r.value = value;
        r.checked = checked;
        l.append(r, el("span", "", nosaukums), el("span", "gray-text", kabinets));
        if (!klase) {
            const x = el("button", "nonemt", "×");
            x.type = "button";
            x.dataset.idx = value;
            x.title = "Dzēst no stundu saraksta";
            l.append(x);
        }
        return l;
    };

    const iz = picker.izvele;
    const nodes: HTMLElement[] = [
        opcija("keep", tagad ? `Atstāt: ${tagad.nosaukums}` : "Atstāt esošo", "", iz === "keep", "specials"),
        opcija("none", "Nav stundas", "", iz === "none", "specials"),
        ...picker.saraksts.map((s, idx) => opcija(String(idx), s.nosaukums, kabinetsRadit(s),
            typeof iz === "object" && sameStunda(iz, s))),
    ];
    if (picker.saraksts.length === 0) nodes.push(el("p", "gray-text", "Nekas netika atrasts — pievieno zemāk kā jaunu stundu."));
    $("picker-saraksts").replaceChildren(...nodes);
}

function setIzvele(izvele: Izvele): void {
    picker.izvele = izvele;
    const kab = $<HTMLInputElement>("picker-kabinets");
    const viens = picker.merki.length === 1 ? picker.merki[0]! : null;
    kab.disabled = izvele === "none";
    picker.kabinetsMainits = false;
    if (izvele === "keep") {
        kab.value = picker.sakumaKabinets;
        kab.placeholder = viens ? "" : "Atstāt esošo";
    } else if (izvele !== "none") {
        // Katrai klasei savs kabinets; ja ieraksta ar roku — tas būs visām atlasītajām
        kab.value = viens ? kabinetsFor(viens, izvele) : "";
        kab.placeholder = viens ? "" : "Katrai klasei savs kabinets";
    }
}

function onPickerListChange(e: Event): void {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.name !== "stunda") return;
    if (t.value === "keep" || t.value === "none") setIzvele(t.value);
    else {
        const s = picker.saraksts[Number(t.value)];
        if (s) setIzvele({ ...s });
    }
}

function onPickerListClick(e: MouseEvent): void {
    const x = (e.target as HTMLElement).closest<HTMLButtonElement>("button.nonemt");
    const s = x?.dataset.idx !== undefined ? picker.saraksts[Number(x.dataset.idx)] : undefined;
    if (!dati || !s) return;
    e.preventDefault(); // lai neizvēlas šo radio
    if (!confirm(`Dzēst "${stundaText(s)}" no stundu saraksta?`)) return;
    dati.stundas = dati.stundas.filter(x => !sameStunda(x, s));
    if (typeof picker.izvele === "object" && sameStunda(picker.izvele, s)) setIzvele("keep");
    commit();
    renderPickerList();
}

function onPickerSearchKey(e: KeyboardEvent): void {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const pirma = picker.saraksts[0];
    if (!pirma) return;
    setIzvele({ ...pirma });
    renderPickerList();
    $<HTMLInputElement>("picker-kabinets").focus();
}

/** Pievieno "Jauna stunda" laukos ierakstīto stundu un izvēlas to. false, ja nekas nav ierakstīts. */
function takeJaunaStunda(): boolean {
    if (!dati) return false;
    const nos = $<HTMLInputElement>("jauna-nosaukums");
    const kab = $<HTMLInputElement>("jauna-kabinets");
    const nosaukums = nos.value.trim();
    if (!nosaukums) return false;
    const ierakstitais = kab.value.trim();
    const s = addStunda({ nosaukums, kabinets: ierakstitais });
    nos.value = "";
    kab.value = "";
    $<HTMLInputElement>("picker-meklet").value = "";
    setIzvele({ ...s });
    if (ierakstitais) {
        // Jaunajai stundai ierakstītais kabinets ir apzināta izvēle
        $<HTMLInputElement>("picker-kabinets").value = ierakstitais;
        picker.kabinetsMainits = true;
    }
    return true;
}

function onJaunaStunda(): void {
    if (!takeJaunaStunda()) {
        $<HTMLInputElement>("jauna-nosaukums").focus();
        return;
    }
    commit();
    renderPickerList();
}

function onJaunaKey(e: KeyboardEvent): void {
    if (e.key !== "Enter") return;
    e.preventDefault(); // citādi Enter aizvērtu logu, nepievienojot stundu
    onJaunaStunda();
}

function applyPicker(): void {
    if (!dati) return;
    const d = dati;
    const kab = $<HTMLInputElement>("picker-kabinets").value.trim();
    const iz = picker.izvele;
    let mainits = 0;

    for (const s of picker.merki) {
        if (!d.klases.includes(s.klase) || s.i >= d.stunduSkaits) continue;
        const tagad = pickerCurrent(s);

        let next: Ieraksts;
        if (iz === "none") next = null;
        else if (iz === "keep") {
            if (!tagad || !picker.kabinetsMainits) continue;
            next = { nosaukums: tagad.nosaukums, kabinets: kab };
        } else {
            next = { nosaukums: iz.nosaukums, kabinets: picker.kabinetsMainits ? kab : kabinetsFor(s, iz) };
        }

        if (picker.rezims === "izmainas") setIzmaina(s.klase, s.i, next);
        else setPamatplans(s.klase, s.i, next);
        mainits++;
    }

    if (mainits === 0) return;
    if (picker.merki.length > 1) atlase.clear();
    commit();
}

function revertPicker(): void {
    if (!dati) return;
    for (const s of picker.merki) removeIzmaina(s.klase, s.i);
    if (picker.merki.length > 1) atlase.clear();
    commit();
}

// ---------- Bilžu karuselis (iekšēji — "reklamas") ----------

const MAX_MALA = 1200;              // garākā mala pēc samazināšanas (TV widgetā tik un tā ~240px)
const MAX_FAILS = 15 * 1024 * 1024; // = MAX_ATTELS server.mjs
const ATTELU_TIPI = /^image\/(png|p?jpeg|webp|gif)$/; // pjpeg = .jfif foto (Chrome)
const ATTELU_PAPLASINAJUMI = /\.(png|jpe?g|jfif|webp|gif)$/i; // ja pārlūks faila tipu nepasaka
const VECS_KARUSELIS = "Serveris vēl darbojas ar veco versiju, kurai nav bilžu karuseļa. Aizver to un palaid server.mjs no jauna, tad pārlādē lapu.";

let augsupielade = false;
let reklamasKey = "";   // lai sīktēlus pārzīmē tikai tad, kad saraksts mainās
let velkId: string | null = null;

/** Vai serveris atbalsta karuseli (vecais server.mjs datos "reklamas" nesūta). */
function karuselisPieejams(): boolean {
    return !!dati?.reklamas;
}

function getReklamas(): Reklamas {
    return dati?.reklamas ?? { periods: 10, atteli: [] };
}

/** Paziņojums karuseļa kastē (augšupielāde, kļūdas). */
function karuselaStatuss(text: string, kluda = false): void {
    const p = $("karuselis-statuss");
    p.textContent = text;
    p.classList.toggle("kluda", kluda);
}

function renderReklamas(): void {
    const periods = $<HTMLInputElement>("reklamas-periods");
    const r = getReklamas();
    const pieejams = karuselisPieejams();
    if (document.activeElement !== periods) periods.value = String(r.periods);
    periods.disabled = !pieejams;
    $<HTMLButtonElement>("reklamas-pievienot").disabled = !pieejams || augsupielade;
    if (dati && !pieejams) karuselaStatuss(VECS_KARUSELIS, true);

    const key = `${pieejams}|${JSON.stringify(r.atteli)}`;
    if (key === reklamasKey) return;
    reklamasKey = key;

    const box = $("reklamas-saraksts");
    if (r.atteli.length === 0) {
        box.replaceChildren(el("p", "reklamas-tuksas", "Nav bilžu. Ievelc tās šeit vai spied „Pievienot bildes“."));
        return;
    }

    box.replaceChildren(...r.atteli.map((a, idx) => {
        const karte = el("div", "reklama-karte");
        karte.dataset.id = a.id;
        karte.draggable = true;

        const skats = el("div", "reklama-prieksskats");
        const img = el("img");
        img.src = reklamaUrl(a.id);
        img.alt = a.nosaukums;
        img.loading = "lazy";
        skats.append(img);

        const info = el("div", "reklama-info");
        const nos = el("span", "reklama-nosaukums", a.nosaukums || "bilde");
        nos.title = a.nosaukums;
        info.append(el("span", "reklama-nr", `${idx + 1}.`), nos);

        const pogas = el("div", "reklama-pogas");
        const poga = (darbiba: string, teksts: string, title: string, klase = "poga"): HTMLButtonElement => {
            const b = el("button", klase, teksts);
            b.type = "button";
            b.dataset.darbiba = darbiba;
            b.title = title;
            return b;
        };
        const pa_kreisi = poga("kreisi", "‹", "Rādīt agrāk");
        const pa_labi = poga("labi", "›", "Rādīt vēlāk");
        pa_kreisi.disabled = idx === 0;
        pa_labi.disabled = idx === r.atteli.length - 1;
        pogas.append(pa_kreisi, pa_labi, poga("dzest", "×", "Dzēst bildi", "nonemt"));

        karte.append(skats, info, pogas);
        return karte;
    }));
}

function parvietotReklamu(id: string, uz: number): void {
    if (!karuselisPieejams()) return;
    const atteli = getReklamas().atteli;
    const no = atteli.findIndex(a => a.id === id);
    if (no < 0) return;
    const [a] = atteli.splice(no, 1);
    atteli.splice(Math.max(0, Math.min(uz, atteli.length)), 0, a!);
    commit();
}

/** Lieliem foto samazina izmēru (WEBP), lai TV nav jāvelk 5 MB bilde 240px kastē. GIF atstāj, kā ir. */
async function samazinat(f: File): Promise<Blob> {
    if (f.type === "image/gif") return f; // citādi pazustu animācija
    let bmp: ImageBitmap;
    try {
        bmp = await createImageBitmap(f);
    } catch {
        return f; // serveris pārbaudīs pats
    }
    const canvas = document.createElement("canvas");
    try {
        const k = Math.min(1, MAX_MALA / Math.max(bmp.width, bmp.height));
        if (k === 1 && f.size < 1_500_000) return f;
        canvas.width = Math.round(bmp.width * k);
        canvas.height = Math.round(bmp.height * k);
        canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/webp", 0.9));
        return blob && blob.size < f.size ? blob : f;
    } finally {
        bmp.close();
        canvas.width = canvas.height = 0; // atbrīvo atmiņu uzreiz
    }
}

async function uploadReklama(blob: Blob, nosaukums: string, signal: AbortSignal): Promise<IzmainuDati> {
    return await augsupieladet(REKLAMU_URL, blob, nosaukums, signal);
}

async function augsupieladet(url: string, blob: Blob, nosaukums: string, signal: AbortSignal): Promise<IzmainuDati> {
    const res = await fetch(url, {
        method: "POST",
        body: blob,
        headers: {
            "Content-Type": blob.type || "application/octet-stream",
            "X-Faila-Nosaukums": encodeURIComponent(nosaukums),
        },
        signal,
    });
    if (res.status === 404 || res.status === 405) throw new Error(VECS_KARUSELIS); // vecais server.mjs
    if (!res.ok) throw new Error((await res.text()) || `Neizdevās augšupielādēt: ${res.status}`);
    return await res.json() as IzmainuDati;
}

/** Gaida, kamēr beidzas iesāktā saglabāšana (maks. ~10 s). */
async function gaidiSaglabasanu(): Promise<void> {
    for (let i = 0; i < 200 && (saglaba || vajagSaglabat); i++) {
        await new Promise(r => setTimeout(r, 50));
    }
}

async function pievienotAttelus(faili: File[]): Promise<void> {
    if (!dati || augsupielade || faili.length === 0) return;
    if (!karuselisPieejams()) {
        karuselaStatuss(VECS_KARUSELIS, true);
        return;
    }
    // Daži pārlūki/sistēmas faila tipu nenosaka — tad skatāmies pēc nosaukuma; serveris pārbauda saturu
    const atteli = faili.filter(f => ATTELU_TIPI.test(f.type) || (!f.type && ATTELU_PAPLASINAJUMI.test(f.name)));
    if (atteli.length === 0) {
        karuselaStatuss("Atbalstītas tikai PNG, JPG, WEBP un GIF bildes", true);
        return;
    }

    augsupielade = true;
    renderReklamas();
    await gaidiSaglabasanu();
    saglaba = true; // kamēr augšupielādē, nesaglabā un neielādē neko citu
    let kluda = "";
    try {
        for (const [n, f] of atteli.entries()) {
            karuselaStatuss(`Augšupielādē ${n + 1}/${atteli.length}: ${f.name}…`);
            const blob = await samazinat(f);
            if (blob.size > MAX_FAILS) {
                kluda = `${f.name} ir pārāk liela (maks. 15 MB)`;
                continue;
            }
            const jauni = await withTimeout(60_000, signal => uploadReklama(blob, f.name, signal));
            if (vajagSaglabat && dati) {
                // pa to laiku ir nesaglabātas izmaiņas — paņemam tikai jauno versiju un reklāmas
                dati.version = jauni.version;
                dati.reklamas = jauni.reklamas;
            } else {
                dati = jauni;
            }
            renderReklamas();
        }
        if (kluda) karuselaStatuss(kluda, true);
        else if (atteli.length < faili.length) karuselaStatuss("Daži faili nav bildes — tie izlaisti", true);
        else karuselaStatuss(`Bildes pievienotas ${laiks()}`);
    } catch (err) {
        console.error(err);
        karuselaStatuss(err instanceof Error && err.message ? err.message : "Neizdevās augšupielādēt", true);
    } finally {
        saglaba = false;
        augsupielade = false;
        renderAll();
        if (vajagSaglabat) void flush();
    }
}

function initReklamas(): void {
    const kaste = document.querySelector<HTMLElement>(".reklamas")!;
    const saraksts = $("reklamas-saraksts");
    const fails = $<HTMLInputElement>("reklamas-fails");

    $("reklamas-pievienot").addEventListener("click", () => fails.click());
    fails.addEventListener("change", () => {
        const f = [...(fails.files ?? [])];
        fails.value = ""; // lai to pašu failu var izvēlēties vēlreiz
        void pievienotAttelus(f);
    });

    $("reklamas-periods").addEventListener("change", e => {
        const input = e.target as HTMLInputElement;
        const v = Math.round(Number(input.value));
        if (!dati || !karuselisPieejams() || !Number.isFinite(v)) return;
        getReklamas().periods = Math.min(600, Math.max(3, v));
        input.value = String(getReklamas().periods);
        commit();
    });

    saraksts.addEventListener("click", e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-darbiba]");
        const id = b?.closest<HTMLElement>(".reklama-karte")?.dataset.id;
        if (!b || !id || !dati || !karuselisPieejams()) return;
        const idx = getReklamas().atteli.findIndex(a => a.id === id);
        if (b.dataset.darbiba === "kreisi") parvietotReklamu(id, idx - 1);
        else if (b.dataset.darbiba === "labi") parvietotReklamu(id, idx + 1);
        else if (b.dataset.darbiba === "dzest") {
            const a = getReklamas().atteli[idx];
            if (!a || !confirm(`Dzēst bildi "${a.nosaukums || idx + 1}"?`)) return;
            getReklamas().atteli.splice(idx, 1);
            commit(); // serveris izdzēš arī failu
        }
    });

    // Secības maiņa, velkot kartītes
    const notiritMerki = (): void => {
        for (const k of saraksts.querySelectorAll(".merkis-pirms, .merkis-pec")) k.classList.remove("merkis-pirms", "merkis-pec");
    };
    saraksts.addEventListener("dragstart", e => {
        const karte = (e.target as HTMLElement).closest<HTMLElement>(".reklama-karte");
        if (!karte?.dataset.id || !e.dataTransfer) return;
        velkId = karte.dataset.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/x-reklama", velkId);
        karte.classList.add("velk");
    });
    saraksts.addEventListener("dragend", () => {
        velkId = null;
        notiritMerki();
        for (const k of saraksts.querySelectorAll(".velk")) k.classList.remove("velk");
    });

    const merkis = (e: DragEvent): { karte: HTMLElement; pec: boolean } | null => {
        const karte = (e.target as HTMLElement).closest<HTMLElement>(".reklama-karte");
        if (!karte) return null;
        const r = karte.getBoundingClientRect();
        return { karte, pec: e.clientX > r.left + r.width / 2 };
    };

    // Failu ievilkšana jebkur reklāmu kastē + kartīšu nomešana
    kaste.addEventListener("dragover", e => {
        const ir_faili = e.dataTransfer?.types.includes("Files");
        if (!ir_faili && !velkId) return;
        e.preventDefault();
        if (ir_faili) kaste.classList.add("velk-virsu");
        else {
            notiritMerki();
            const m = merkis(e);
            if (m && m.karte.dataset.id !== velkId) m.karte.classList.add(m.pec ? "merkis-pec" : "merkis-pirms");
        }
    });
    kaste.addEventListener("dragleave", e => {
        if (!kaste.contains(e.relatedTarget as Node | null)) {
            kaste.classList.remove("velk-virsu");
            notiritMerki();
        }
    });
    kaste.addEventListener("drop", e => {
        e.preventDefault();
        kaste.classList.remove("velk-virsu");
        notiritMerki();
        if (e.dataTransfer?.types.includes("Files")) {
            void pievienotAttelus([...e.dataTransfer.files]);
            return;
        }
        const m = merkis(e);
        if (!velkId || !m?.karte.dataset.id || m.karte.dataset.id === velkId) return;
        const atteli = getReklamas().atteli;
        const no = atteli.findIndex(a => a.id === velkId);
        let uz = atteli.findIndex(a => a.id === m.karte.dataset.id) + (m.pec ? 1 : 0);
        if (no < uz) uz--; // pēc izņemšanas indeksi pabīdās
        parvietotReklamu(velkId, uz);
    });
}

const VECS_TEMA = "Serveris vēl darbojas ar veco versiju, kurai nav pārklājuma. Aizver to un palaid server.mjs no jauna, tad pārlādē lapu.";
const PARKLAJUMA_TIPI = /^image\/(png|webp|gif)$/;
const TV_IZMERS = { platums: 1312, augstums: 752 };

let redzamibaVelk: number | null = null;

function saglabataTema(): Tema {
    return dati?.tema ?? { parklajums: null };
}

function temaPieejama(): boolean {
    return !!dati?.tema;
}

function temaStatuss(text: string, kluda = false): void {
    const p = $("tema-statuss");
    p.textContent = text;
    p.classList.toggle("kluda", kluda);
}

function prieksskataTema(): Tema {
    const p = saglabataTema().parklajums;
    return { parklajums: p ? { ...p, necaurspidigums: redzamibaVelk ?? p.necaurspidigums } : null };
}

function sutitPrieksskatu(): void {
    const iframe = $<HTMLIFrameElement>("tema-iframe");
    iframe.contentWindow?.postMessage({ tips: PRIEKSSKATS_ZINA, tema: prieksskataTema() }, location.origin);
}

function renderTema(): void {
    const pieejama = temaPieejama();
    const park = saglabataTema().parklajums;

    const pievienot = $<HTMLButtonElement>("parklajums-pievienot");
    pievienot.disabled = !pieejama || augsupielade;
    pievienot.textContent = park ? "Aizstāt pārklājumu" : "Pievienot pārklājumu";
    $<HTMLButtonElement>("parklajums-nonemt").disabled = !park;

    const slidnis = $<HTMLInputElement>("parklajums-redzamiba");
    slidnis.disabled = !park;
    const redzamiba = redzamibaVelk ?? park?.necaurspidigums ?? 100;
    if (document.activeElement !== slidnis) slidnis.value = String(redzamiba);
    $("parklajums-proc").textContent = park ? `${redzamiba}%` : "—";

    if (dati && !pieejama) temaStatuss(VECS_TEMA, true);

    sutitPrieksskatu();
}

async function pievienotParklajumu(f: File): Promise<void> {
    if (!dati || augsupielade) return;
    if (!temaPieejama()) {
        temaStatuss(VECS_TEMA, true);
        return;
    }
    if (!PARKLAJUMA_TIPI.test(f.type) && !(!f.type && /\.(png|webp|gif)$/i.test(f.name))) {
        temaStatuss("Pārklājumam vajag caurspīdīgu PNG, WEBP vai GIF attēlu (JPG nevar būt caurspīdīgs)", true);
        return;
    }
    if (f.size > MAX_FAILS) {
        temaStatuss(`${f.name} ir pārāk liels (maks. 15 MB)`, true);
        return;
    }

    let izmers = "";
    try {
        const bmp = await createImageBitmap(f);
        const k = (bmp.width / bmp.height) / (TV_IZMERS.platums / TV_IZMERS.augstums);
        if (Math.abs(k - 1) > 0.02) izmers = ` Uzmanību: attēls ir ${bmp.width} × ${bmp.height} px, tāpēc tas tiks izstiepts līdz ekrāna proporcijām (${TV_IZMERS.platums} × ${TV_IZMERS.augstums}).`;
        bmp.close();
    } catch { }

    augsupielade = true;
    renderAll();
    await gaidiSaglabasanu();
    saglaba = true;
    try {
        temaStatuss(`Augšupielādē ${f.name}…`);
        const jauni = await withTimeout(60_000, signal => augsupieladet(PARKLAJUMU_URL, f, f.name, signal));
        if (vajagSaglabat && dati) {
            dati.version = jauni.version;
            dati.tema = { parklajums: jauni.tema.parklajums };
        } else {
            dati = jauni;
        }
        temaStatuss(`Pārklājums pievienots ${laiks()}.${izmers}`, izmers !== "");
    } catch (err) {
        console.error(err);
        temaStatuss(err instanceof Error && err.message ? err.message.replace(VECS_KARUSELIS, VECS_TEMA) : "Neizdevās augšupielādēt", true);
    } finally {
        saglaba = false;
        augsupielade = false;
        renderAll();
        if (vajagSaglabat) void flush();
    }
}

function initTema(): void {
    const fails = $<HTMLInputElement>("parklajums-fails");
    $("parklajums-pievienot").addEventListener("click", () => fails.click());
    fails.addEventListener("change", () => {
        const f = fails.files?.[0];
        fails.value = "";
        if (f) void pievienotParklajumu(f);
    });
    $("parklajums-nonemt").addEventListener("click", () => {
        if (!dati?.tema?.parklajums || !confirm("Noņemt pārklājumu un atgriezt sākotnējo izskatu?")) return;
        dati.tema = { parklajums: null };
        commit();
        temaStatuss(`Atgriezts sākotnējais izskats (${laiks()})`);
    });

    const slidnis = $<HTMLInputElement>("parklajums-redzamiba");
    slidnis.addEventListener("input", () => {
        redzamibaVelk = Number(slidnis.value);
        $("parklajums-proc").textContent = `${redzamibaVelk}%`;
        sutitPrieksskatu();
    });
    slidnis.addEventListener("change", () => {
        const v = Number(slidnis.value);
        redzamibaVelk = null;
        if (!dati?.tema?.parklajums) return;
        dati.tema = { parklajums: { ...dati.tema.parklajums, necaurspidigums: v } };
        commit();
    });

    $("tema-iframe").addEventListener("load", sutitPrieksskatu);
}

function init(): void {
    initReklamas();
    initTema();

    for (const id of ["izmainas-grid", "pamatplans-grid"]) {
        const root = $(id);
        root.addEventListener("change", onGridChange);
        root.addEventListener("click", onGridClick);
        root.addEventListener("keydown", onGridKey);
    }

    for (const rezims of ["izmainas", "pamatplans"] as const) {
        $(`atlase-bar-${rezims}`).addEventListener("click", e => {
            const darbiba = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.darbiba;
            if (darbiba === "mainit") openPicker(atlasesRezims, [...atlase].map(parseSunaKey));
            else if (darbiba === "notirit") {
                atlase.clear();
                renderGrids();
                renderAtlase();
            } else if (darbiba === "nonemt" && dati) {
                for (const key of atlase) {
                    const s = parseSunaKey(key);
                    removeIzmaina(s.klase, s.i);
                }
                atlase.clear();
                commit();
            }
        });
    }

    // Datuma izvēle: ‹ › pa vienai dienai, poga atver kalendāru, "Šodien"
    $("datums-iepr").addEventListener("click", () => setSkatsDatums(addDays(skatsDatums, -1)));
    $("datums-nak").addEventListener("click", () => setSkatsDatums(addDays(skatsDatums, 1)));
    $("datums-sodien").addEventListener("click", () => setSkatsDatums(todayKey()));
    $("datums-poga").addEventListener("click", () => {
        const input = $<HTMLInputElement>("datums");
        try {
            input.showPicker();
        } catch {
            input.focus(); // vecāki pārlūki bez showPicker()
        }
    });
    $("datums").addEventListener("change", e => setSkatsDatums((e.target as HTMLInputElement).value));

    $("notirit-izmainas").addEventListener("click", () => {
        if (!dati || !dati.izmainas[skatsDatums]) return;
        if (!confirm(`Notīrīt VISAS stundu izmaiņas ${formatDatums(skatsDatums)}? Pamatplāns paliks nemainīts.`)) return;
        delete dati.izmainas[skatsDatums];
        atlase.clear();
        commit();
    });

    $("klase-forma").addEventListener("submit", e => {
        e.preventDefault();
        if (!dati) return;
        const input = $<HTMLInputElement>("klase-nosaukums");
        const p = parseKlase(input.value);
        if (!p) {
            setStatus("Klases nosaukumam jābūt kā 12.g", true);
            return;
        }
        const k = `${p.grade}.${p.letter}`;
        if (dati.klases.includes(k)) {
            setStatus(`Klase ${k} jau ir`, true);
            return;
        }
        dati.klases.push(k); // tukšās rindas katrai dienai serveris izveido pats
        input.value = "";
        commit();
    });

    // Izvēles logs
    const dialog = $<HTMLDialogElement>("picker");
    $("picker-saraksts").addEventListener("change", onPickerListChange);
    $("picker-saraksts").addEventListener("click", onPickerListClick);
    $("picker-meklet").addEventListener("input", renderPickerList);
    $("picker-meklet").addEventListener("keydown", onPickerSearchKey);
    $("picker-kabinets").addEventListener("input", () => { picker.kabinetsMainits = true; });
    $("jauna-pievienot").addEventListener("click", onJaunaStunda);
    $("jauna-nosaukums").addEventListener("keydown", onJaunaKey);
    $("jauna-kabinets").addEventListener("keydown", onJaunaKey);
    dialog.addEventListener("click", e => {
        if (e.target === dialog) dialog.close("cancel");
    });
    dialog.addEventListener("close", () => {
        if (dialog.returnValue === "apply") {
            // Ja jaunā stunda ir ierakstīta, bet "+" nav nospiests — pievienojam to tagad
            takeJaunaStunda();
            applyPicker();
        }
        else if (dialog.returnValue === "revert") revertPicker();
        picker.merki = [];
    });

    document.addEventListener("pointerdown", () => { pelesPoga = true; }, true);
    document.addEventListener("pointerup", pelesAtlaista, true);
    document.addEventListener("pointercancel", pelesAtlaista, true);
    window.addEventListener("blur", pelesAtlaista);

    window.addEventListener("beforeunload", e => {
        if (saglaba || vajagSaglabat) e.preventDefault();
    });
    window.addEventListener("pagehide", () => {
        clearTimeout(pollTaimeris);
        pollTaimeris = undefined;
    });
    window.addEventListener("pageshow", e => {
        if (e.persisted && pollTaimeris === undefined) void poll();
    });

    renderAll();
    void poll();
}

init();
