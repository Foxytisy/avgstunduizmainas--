// Stundu izmaiņu serveris — bez atkarībām, vajag tikai Node 18+.
//
//   node server.mjs            -> http://localhost:8080/
//   PORT=80 node server.mjs
//
// Pasniedz visu projekta mapi (tā, kurā atrodas šis fails) kā statiskus failus
// un glabā izmaiņas failā data/izmainas.json.
//   GET  /api/izmainas         -> visi dati (TV un dashboard)
//   PUT  /api/izmainas         -> saglabā datus (dashboard) — arī reklāmu secību, periodu, dzēšanu
//   POST /api/reklamas         -> augšupielādē vienu attēlu (ķermenis = attēla baiti)
//   GET  /api/reklamas/<id>    -> attēls (glabājas data/reklamas/)
//   POST /api/parklajumi       -> augšupielādē tēmas pārklājumu (aizstāj iepriekšējo)
//   GET  /api/parklajumi/<id>  -> pārklājuma attēls (glabājas data/parklajumi/)
//
// Datu forma:
//   pamatplans[nedēļas diena "0"–"6"][klase] = stundas      (katra pirmdiena vienāda utt.)
//   izmainas["YYYY-MM-DD"][klase]["indekss"] = stunda       (glabā pēdējās GLABA_DIENAS dienas)
//   atjaunots["YYYY-MM-DD"] = ms, kad tā datuma izmaiņas pēdējo reizi mainījās
// Vecā forma (viens pamatplāns + viens datums) tiek pārveidota automātiski.

import http from "node:http";
import { readFile, writeFile, rename, mkdir, stat, readdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "izmainas.json");
const REKLAMU_DIR = path.join(DATA_DIR, "reklamas");
const REKLAMU_URL = "/api/reklamas";
const MAX_ATTELS = 15 * 1024 * 1024;  // viena attēla maksimālais izmērs
const MAX_REKLAMAS = 50;
const REKLAMA_ID_RE = /^[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
const PARKLAJUMU_DIR = path.join(DATA_DIR, "parklajumi");
const PARKLAJUMU_URL = "/api/parklajumi";
const PARKLAJUMA_ID_RE = /^[a-f0-9]{16}\.(png|webp|gif)$/; // tikai formāti ar caurspīdīgumu
const PORT = Number(process.env.PORT) || 8080;
const MAX_BODY = 512 * 1024;
const API_URL = "/api/izmainas";
// Datu formas versija ETag galvenē. Ja forma mainās, pārlūks nedrīkst izmantot vecu
// kešā saglabātu atbildi tikai tāpēc, ka sakrīt version skaitlis.
const FORMA = "f4";
const etagOf = s => `"${FORMA}-v${s.version}"`;

const KLASE_RE = /^\d{1,2}\.\p{L}{1,3}$/u;
const DATUMS_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIENAS = ["0", "1", "2", "3", "4", "5", "6"];  // Date.getDay(): 0 = svētdiena
const DARBA_DIENAS = ["1", "2", "3", "4", "5"];
const MAX_DATUMI = 120;
const GLABA_DIENAS = 31; // cik dienas atpakaļ glabāt izmaiņas (= GLABA_DIENAS izmainas-dati.ts)
const BLOKETS = new Set(["data", "node_modules", "server.mjs", "package.json", "package-lock.json"]);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

// ---------- Dati ----------

function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Vecākais datums, ko vēl glabājam; vecākas izmaiņas tiek izdzēstas. */
function oldestKey() {
    const d = new Date();
    d.setDate(d.getDate() - GLABA_DIENAS);
    return todayKey(d);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function clampInt(v, min, max, fallback) {
    return Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function sanitizeStunda(v) {
    if (v === null || typeof v !== "object") return null;
    const nosaukums = str(v.nosaukums, 80);
    if (!nosaukums) return null;
    return { nosaukums, kabinets: str(v.kabinets, 20) };
}

/**
 * Reklāmas: { periods: sekundes, atteli: [{ id, nosaukums }] } — secība = rādīšanas secība.
 * atlautie: id, kas drīkst būt sarakstā (jau augšupielādētie). Pievienot var tikai ar POST.
 */
function sanitizeReklamas(v, atlautie) {
    const ievade = v && typeof v === "object" ? v : {};
    const periods = clampInt(ievade.periods, 3, 600, 10);
    const atteli = [];
    const redzeti = new Set();
    for (const a of Array.isArray(ievade.atteli) ? ievade.atteli : []) {
        const id = typeof a?.id === "string" ? a.id : "";
        if (!REKLAMA_ID_RE.test(id) || redzeti.has(id) || (atlautie && !atlautie.has(id))) continue;
        redzeti.add(id);
        atteli.push({ id, nosaukums: str(a.nosaukums, 100) });
    }
    return { periods, atteli: atteli.slice(0, MAX_REKLAMAS) };
}

function sanitizeTema(v, esosaisParklajums) {
    const t = v && typeof v === "object" ? v : {};
    const p = t.parklajums;
    const parklajums = p && esosaisParklajums && p.id === esosaisParklajums.id
        ? { id: esosaisParklajums.id, nosaukums: esosaisParklajums.nosaukums, necaurspidigums: Number.isInteger(p.necaurspidigums) ? Math.min(100, Math.max(10, p.necaurspidigums)) : 100 }
        : null;
    return { parklajums };
}

// Pārbūvē datus no nulles, lai failā nekad nenonāk nekas lieks vai bīstams.
function sanitize(input) {
    if (!input || typeof input !== "object") throw new Error("Nederīgi dati");

    const stunduSkaits = clampInt(input.stunduSkaits, 1, 16, 11);
    const klases = [...new Set((Array.isArray(input.klases) ? input.klases : [])
        .map(k => str(k, 6))
        .filter(k => KLASE_RE.test(k)))]
        .slice(0, 200);

    const stundas = [];
    const redzetas = new Set();
    for (const s of (Array.isArray(input.stundas) ? input.stundas : []).slice(0, 500)) {
        const clean = sanitizeStunda(s);
        if (!clean) continue;
        const key = `${clean.nosaukums}\u0000${clean.kabinets}`;
        if (redzetas.has(key)) continue;
        redzetas.add(key);
        stundas.push(clean);
    }

    const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
    const rinda = v => Array.from({ length: stunduSkaits }, (_, i) => sanitizeStunda(Array.isArray(v) ? v[i] : null));
    const sodien = todayKey();

    // Pamatplāns katrai nedēļas dienai
    const ievPamat = isObj(input.pamatplans) ? input.pamatplans : {};
    const vecaisPamat = Object.values(ievPamat).some(Array.isArray); // vecā forma: klase -> stundas
    const pamatplans = {};
    for (const d of DIENAS) {
        // Vecais plāns tiek nokopēts uz visām darba dienām
        const avots = vecaisPamat ? (DARBA_DIENAS.includes(d) ? ievPamat : {}) : (isObj(ievPamat[d]) ? ievPamat[d] : {});
        pamatplans[d] = {};
        for (const k of klases) pamatplans[d][k] = rinda(avots[k]);
    }

    // Izmaiņas katram datumam (pagājušos izmetam)
    const ievIzm = isObj(input.izmainas) ? input.izmainas : {};
    const vecasIzm = Object.keys(ievIzm).some(k => KLASE_RE.test(k)); // vecā forma: klase -> izmaiņas
    const datumi = vecasIzm
        ? [[typeof input.datums === "string" && DATUMS_RE.test(input.datums) ? input.datums : sodien, ievIzm]]
        : Object.entries(ievIzm).filter(([d, v]) => DATUMS_RE.test(d) && isObj(v));

    const izmainas = {};
    for (const [datums, diena] of datumi.sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (datums < oldestKey() || Object.keys(izmainas).length >= MAX_DATUMI) continue;
        const cleanDiena = {};
        for (const k of klases) {
            const o = diena[k];
            if (!isObj(o)) continue;
            const clean = {};
            for (let i = 0; i < stunduSkaits; i++) {
                if (Object.hasOwn(o, String(i))) clean[i] = sanitizeStunda(o[i]);
            }
            if (Object.keys(clean).length > 0) cleanDiena[k] = clean;
        }
        if (Object.keys(cleanDiena).length > 0) izmainas[datums] = cleanDiena;
    }

    const iepriekPark = input.tema?.parklajums;
    const uzticamsPark = iepriekPark && PARKLAJUMA_ID_RE.test(iepriekPark.id)
        ? { id: iepriekPark.id, nosaukums: str(iepriekPark.nosaukums, 100) } : null;
    return {
        stunduSkaits, klases, stundas, pamatplans, izmainas,
        reklamas: sanitizeReklamas(input.reklamas, null),
        tema: sanitizeTema(input.tema, uzticamsPark),
    };
}

/** atjaunots: { datums: ms } — vecajā formā tas bija viens skaitlis */
function sanitizeAtjaunots(raw, izmainas) {
    const sodien = todayKey();
    const out = {};
    if (raw && typeof raw === "object") {
        for (const [d, ms] of Object.entries(raw)) {
            if (DATUMS_RE.test(d) && d >= oldestKey() && typeof ms === "number") out[d] = ms;
        }
    }
    for (const d of Object.keys(izmainas)) out[d] ??= 0;
    return out;
}

function seed() {
    const S = (nosaukums, kabinets = "") => ({ nosaukums, kabinets });
    const fizika = S("Fizika", "134");
    const sports = S("Sports un Veselība");
    const mat = S("Matemātika I/II", "112");
    const latv = S("Latviešu val. un Literatūra II", "3109");
    const audz = S("Audzināšana", "112");
    const soc = S("Sociālās Zinātnes II", "112");
    const vest = S("Latvijas un Pasaules Vēsture", "3108");
    const fizPr = S("Fizikas Praktikums", "134");
    const pusd = S("Pusdienas");

    const klases = [];
    for (let g = 7; g <= 12; g++) for (const l of ["a", "b", "c", "d"]) klases.push(`${g}.${l}`);

    const plans = {
        "12.a": [fizika, sports, mat, audz, latv, soc, vest, pusd, null, null, null],
        "12.b": [null, sports, mat, latv, fizika, soc, vest, null, null, null, null],
        "12.c": [fizika, fizika, mat, soc, audz, soc, pusd, fizPr, fizPr, null, null],
        "12.d": [null, null, mat, latv, audz, soc, vest, fizPr, fizPr, null, null],
    };
    const sodien = todayKey();

    return {
        version: 1,
        atjaunots: { [sodien]: Date.now() },
        ...sanitize({
            stunduSkaits: 11,
            klases,
            stundas: [fizika, sports, mat, latv, audz, soc, vest, fizPr, pusd],
            pamatplans: Object.fromEntries(DARBA_DIENAS.map(d => [d, plans])),
            izmainas: {
                [sodien]: {
                    "12.a": { 3: latv, 4: audz, 7: fizPr, 8: fizPr, 9: pusd },
                    "12.b": { 4: audz },
                    "12.c": { 1: sports, 3: latv },
                    "12.d": { 9: pusd },
                },
            },
        }),
    };
}

async function loadState() {
    try {
        const raw = JSON.parse(await readFile(DATA_FILE, "utf8"));
        const clean = sanitize(raw);
        const atjaunots = typeof raw.atjaunots === "number"
            ? { [typeof raw.datums === "string" && DATUMS_RE.test(raw.datums) ? raw.datums : todayKey()]: raw.atjaunots }
            : sanitizeAtjaunots(raw.atjaunots, clean.izmainas);
        const s = {
            version: clampInt(raw.version, 1, Number.MAX_SAFE_INTEGER, 1),
            atjaunots,
            ...clean,
        };
        s.reklamas.atteli = await esosieAtteli(s.reklamas.atteli);
        if (s.tema.parklajums && !(await readdir(PARKLAJUMU_DIR).catch(() => [])).includes(s.tema.parklajums.id)) {
            s.tema.parklajums = null; // fails pazudis
        }
        if (!raw.pamatplans?.["1"] || raw.datums !== undefined) {
            s.version += 1; // pārveidoti dati = jauna versija
            console.log("Dati pārveidoti jaunajā formā (pamatplāns pa nedēļas dienām, izmaiņas pa datumiem).");
            await persist(s);
        }
        return s;
    } catch (err) {
        if (err.code !== "ENOENT") console.error("Neizdevās nolasīt datus, izveidoju jaunus:", err.message);
        const s = seed();
        await persist(s);
        return s;
    }
}

// Rakstīšanas rinda: faili tiek rakstīti pa vienam, caur pagaidu failu + rename,
// lai strāvas pazušana nekad neatstāj pusē uzrakstītu JSON.
let writeChain = Promise.resolve();

function persist(snapshot) {
    const json = JSON.stringify(snapshot, null, 2);
    const p = writeChain.then(async () => {
        await mkdir(DATA_DIR, { recursive: true });
        const tmp = `${DATA_FILE}.tmp`;
        await writeFile(tmp, json, "utf8");
        await rename(tmp, DATA_FILE);
    });
    writeChain = p.catch(() => {});
    return p;
}

/** Atstāj tikai tos attēlus, kuru faili tiešām ir uz diska. */
async function esosieAtteli(atteli) {
    const faili = new Set(await readdir(REKLAMU_DIR).catch(() => []));
    return atteli.filter(a => faili.has(a.id));
}

/** Izdzēš attēlu failus, kas vairs nav sarakstā (piem. dzēsti dashboard). */
async function notiritReklamas(atteli) {
    const vajag = new Set(atteli.map(a => a.id));
    for (const f of await readdir(REKLAMU_DIR).catch(() => [])) {
        if (REKLAMA_ID_RE.test(f) && !vajag.has(f)) await unlink(path.join(REKLAMU_DIR, f)).catch(() => {});
    }
}

/** Attēla veids pēc pirmajiem baitiem (nevis pēc nosaukuma vai Content-Type, kam var meloties). */
function attelaVeids(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "png";
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
    if (buf.length > 6 && buf.toString("latin1", 0, 4) === "GIF8") return "gif";
    if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
    return null;
}

/** Izdzēš pārklājuma failus, izņemot pašreizējo. */
async function notiritParklajumus(parklajums) {
    for (const f of await readdir(PARKLAJUMU_DIR).catch(() => [])) {
        if (PARKLAJUMA_ID_RE.test(f) && f !== parklajums?.id) await unlink(path.join(PARKLAJUMU_DIR, f)).catch(() => {});
    }
}

let state = await loadState();
await notiritReklamas(state.reklamas.atteli);
await notiritParklajumus(state.tema.parklajums);

// ---------- HTTP palīgi ----------

function send(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
    res.end(body);
}

function sendJson(res, status, data, headers = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-cache",
        ...headers,
    });
    res.end(body);
}

function readBody(req, limit = MAX_BODY) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let parak = false;
        const onData = chunk => {
            size += chunk.length;
            if (size > limit) {
                parak = true;
                chunks.length = 0;
                req.off("data", onData);
                req.resume(); // izlasām līdz galam, lai varam atbildēt ar 413
                return;
            }
            chunks.push(chunk);
        };
        req.on("data", onData);
        req.once("end", () => (parak
            ? reject(Object.assign(new Error("Pārāk liels pieprasījums"), { status: 413 }))
            : resolve(Buffer.concat(chunks))));
        req.once("error", reject);
    });
}

// ---------- Maršruti ----------

async function handleApi(req, res) {
    const etag = etagOf(state);

    if (req.method === "GET" || req.method === "HEAD") {
        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
            res.end();
            return;
        }
        return sendJson(res, 200, state, { ETag: etag });
    }

    if (req.method === "PUT") {
        let input;
        try {
            input = JSON.parse((await readBody(req)).toString("utf8"));
        } catch (err) {
            return send(res, err.status ?? 400, err.status ? err.message : "Nederīgs JSON");
        }

        // Ja kāds cits jau saglabāja jaunāku versiju — atdodam to, nevis pārrakstām.
        if (input?.version !== state.version) return sendJson(res, 409, state, { ETag: etag });

        let clean;
        try {
            clean = sanitize(input);
        } catch {
            return send(res, 400, "Nederīgi dati");
        }
        // Reklāmas: drīkst mainīt secību, periodu un dzēst — bet ne pievienot (tas ir POST).
        // Ja dashboard reklāmas nesūta (vecāka versija), atstājam esošās.
        clean.reklamas = input.reklamas === undefined
            ? state.reklamas
            : sanitizeReklamas(input.reklamas, new Set(state.reklamas.atteli.map(a => a.id)));
        // Tēma: ja dashboard to nesūta (vecāka versija), atstājam esošo
        clean.tema = input.tema === undefined ? state.tema : sanitizeTema(input.tema, state.tema.parklajums);

        // "Atjaunināts" katram datumam atsevišķi — tikai tiem, kuru izmaiņas tiešām mainījās
        const sodien = todayKey();
        const atjaunots = {};
        const datumi = new Set([...Object.keys(state.izmainas), ...Object.keys(clean.izmainas), ...Object.keys(state.atjaunots)]);
        for (const d of datumi) {
            if (d < oldestKey()) continue;
            const mainijas = JSON.stringify(clean.izmainas[d] ?? null) !== JSON.stringify(state.izmainas[d] ?? null);
            if (mainijas) atjaunots[d] = Date.now();
            else if (state.atjaunots[d] !== undefined) atjaunots[d] = state.atjaunots[d];
        }

        state = {
            version: state.version + 1,
            atjaunots,
            ...clean,
        };

        try {
            await persist(state);
        } catch (err) {
            console.error("Neizdevās saglabāt:", err);
            return send(res, 500, "Neizdevās saglabāt failā");
        }
        await notiritReklamas(state.reklamas.atteli);
        await notiritParklajumus(state.tema.parklajums);
        return sendJson(res, 200, state, { ETag: etagOf(state) });
    }

    send(res, 405, "Metode nav atļauta", { Allow: "GET, HEAD, PUT" });
}

/** POST /api/reklamas — viens attēls. Pievieno saraksta beigās un atgriež visus datus. */
async function handleUpload(req, res) {
    if (req.method !== "POST") return send(res, 405, "Metode nav atļauta", { Allow: "POST" });
    if (state.reklamas.atteli.length >= MAX_REKLAMAS) return send(res, 400, `Var būt ne vairāk kā ${MAX_REKLAMAS} attēli`);

    let buf;
    try {
        buf = await readBody(req, MAX_ATTELS);
    } catch (err) {
        return send(res, err.status ?? 400, err.status ? "Attēls ir pārāk liels (maks. 15 MB)" : "Neizdevās nolasīt");
    }
    const veids = attelaVeids(buf);
    if (!veids) return send(res, 415, "Atbalstīti tikai PNG, JPG, WEBP un GIF attēli");

    let nosaukums = "";
    try {
        nosaukums = decodeURIComponent(String(req.headers["x-faila-nosaukums"] ?? ""));
    } catch { /* nosaukums nav obligāts */ }

    const id = `${randomBytes(8).toString("hex")}.${veids}`;
    try {
        await mkdir(REKLAMU_DIR, { recursive: true });
        await writeFile(path.join(REKLAMU_DIR, id), buf);
    } catch (err) {
        console.error("Neizdevās saglabāt attēlu:", err);
        return send(res, 500, "Neizdevās saglabāt attēlu");
    }

    state = {
        ...state,
        version: state.version + 1,
        reklamas: { ...state.reklamas, atteli: [...state.reklamas.atteli, { id, nosaukums: str(nosaukums, 100) }] },
    };
    try {
        await persist(state);
    } catch (err) {
        console.error("Neizdevās saglabāt:", err);
        return send(res, 500, "Neizdevās saglabāt failā");
    }
    return sendJson(res, 200, state, { ETag: etagOf(state) });
}

/** POST /api/parklajumi — tēmas pārklājums (caurspīdīgs attēls). Aizstāj iepriekšējo. */
async function handleParklajums(req, res) {
    if (req.method !== "POST") return send(res, 405, "Metode nav atļauta", { Allow: "POST" });
    let buf;
    try {
        buf = await readBody(req, MAX_ATTELS);
    } catch (err) {
        return send(res, err.status ?? 400, err.status ? "Attēls ir pārāk liels (maks. 15 MB)" : "Neizdevās nolasīt");
    }
    const veids = attelaVeids(buf);
    if (!veids || veids === "jpg") return send(res, 415, "Pārklājumam vajag caurspīdīgu PNG, WEBP vai GIF attēlu (JPG nevar būt caurspīdīgs)");

    let nosaukums = "";
    try {
        nosaukums = decodeURIComponent(String(req.headers["x-faila-nosaukums"] ?? ""));
    } catch { /* nav obligāts */ }

    const id = `${randomBytes(8).toString("hex")}.${veids}`;
    try {
        await mkdir(PARKLAJUMU_DIR, { recursive: true });
        await writeFile(path.join(PARKLAJUMU_DIR, id), buf);
    } catch (err) {
        console.error("Neizdevās saglabāt pārklājumu:", err);
        return send(res, 500, "Neizdevās saglabāt attēlu");
    }

    state = {
        ...state,
        version: state.version + 1,
        tema: { ...state.tema, parklajums: { id, nosaukums: str(nosaukums, 100), necaurspidigums: 100 } },
    };
    try {
        await persist(state);
    } catch (err) {
        console.error("Neizdevās saglabāt:", err);
        return send(res, 500, "Neizdevās saglabāt failā");
    }
    await notiritParklajumus(state.tema.parklajums); // vecais pārklājums vairs nav vajadzīgs
    return sendJson(res, 200, state, { ETag: etagOf(state) });
}

/** GET /api/reklamas/<id> un /api/parklajumi/<id>. id ir nejaušs un nemainīgs, tāpēc drīkst kešot ilgi. */
async function serveAugsupielade(req, res, dir, idRe, id) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Metode nav atļauta");
    if (!idRe.test(id)) return send(res, 404, "Nav atrasts");
    const file = path.join(dir, id);
    let info;
    try {
        info = await stat(file);
    } catch {
        return send(res, 404, "Nav atrasts");
    }
    res.writeHead(200, {
        "Content-Type": MIME[path.extname(id)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    try {
        await pipeline(createReadStream(file), res);
    } catch (err) {
        if (err.code !== "ERR_STREAM_PREMATURE_CLOSE") console.error(err);
    }
}

async function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, "Metode nav atļauta", { Allow: "GET, HEAD" });
    }

    let rel;
    try {
        rel = decodeURIComponent(pathname);
    } catch {
        return send(res, 400, "Nederīga adrese");
    }
    if (rel.includes("\0")) return send(res, 400, "Nederīga adrese");

    let file = path.resolve(ROOT, `.${rel}`);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, "Aizliegts");

    const pirmais = path.relative(ROOT, file).split(path.sep)[0] ?? "";
    if (BLOKETS.has(pirmais) || pirmais.startsWith(".")) return send(res, 404, "Nav atrasts");

    let info;
    try {
        info = await stat(file);
        if (info.isDirectory()) {
            // Relatīvie ceļi (../assets) strādā tikai ar "/" beigās.
            if (!pathname.endsWith("/")) return send(res, 301, "", { Location: `${pathname}/` });
            file = path.join(file, "index.html");
            info = await stat(file);
        }
    } catch {
        return send(res, 404, "Nav atrasts");
    }

    res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-cache",
        "Last-Modified": info.mtime.toUTCString(),
    });
    if (req.method === "HEAD") return res.end();

    try {
        // pipeline aizver failu arī tad, ja klients pārtrauc savienojumu.
        await pipeline(createReadStream(file), res);
    } catch (err) {
        if (err.code !== "ERR_STREAM_PREMATURE_CLOSE") console.error(err);
    }
}

const server = http.createServer(async (req, res) => {
    try {
        const { pathname } = new URL(req.url ?? "/", "http://localhost");
        if (pathname === API_URL) await handleApi(req, res);
        else if (pathname === REKLAMU_URL) await handleUpload(req, res);
        else if (pathname.startsWith(`${REKLAMU_URL}/`)) await serveAugsupielade(req, res, REKLAMU_DIR, REKLAMA_ID_RE, pathname.slice(REKLAMU_URL.length + 1));
        else if (pathname === PARKLAJUMU_URL) await handleParklajums(req, res);
        else if (pathname.startsWith(`${PARKLAJUMU_URL}/`)) await serveAugsupielade(req, res, PARKLAJUMU_DIR, PARKLAJUMA_ID_RE, pathname.slice(PARKLAJUMU_URL.length + 1));
        else await serveStatic(req, res, pathname);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) send(res, 500, "Servera kļūda");
        else res.destroy();
    }
});

server.on("error", err => {
    if (err.code === "EADDRINUSE") {
        console.error(`Ports ${PORT} jau ir aizņemts — droši vien vēl darbojas vecais serveris.`);
        console.error("Aizver to (Ctrl + C tā logā vai uzdevumu pārvaldniekā \"Node.js\") un palaid šo vēlreiz.");
    } else {
        console.error(err);
    }
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`Serveris darbojas: http://localhost:${PORT}/`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
        server.close();
        server.closeAllConnections();
        writeChain.finally(() => process.exit(0));
    });
}
