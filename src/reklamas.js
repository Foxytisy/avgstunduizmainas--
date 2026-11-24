// TV "Fotoarhīvs" widget kā reklāmu stends: attēli pēc kārtas, ik pēc N sekundēm
// nākamais iebīdās no apakšas un iepriekšējais aizbrauc uz augšu.
//
// Nav noplūžu: tiek lietoti tikai divi <img> elementi (redzamais un nākamais), kas mainās
// lomām; vienlaikus pastāv ne vairāk kā viens taimeris; animācijas beidzas pašas.
// Dati nāk no izmainas.ts (tas pats pieprasījums serverim) caur atjaunotReklamas().
import { reklamaUrl } from "./izmainas-dati.js";
const SLIDE_MS = 900;
// Strauji sāk un tikai beigās mierīgi piebremzē (kā iOS animācijās) — nevis lēns sākums + lēnas beigas.
const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
let saraksts = [];
let periodsMs = 10_000;
let pasreizejais = null; // redzamā attēla id
let pedejaisIndekss = 0;
let taimeris;
let animacija = false;
let kaste = null;
let redzamais;
let nakamais;
function createImg() {
    const img = document.createElement("img");
    img.className = "reklama";
    img.alt = "";
    img.draggable = false;
    return img;
}
function init() {
    if (kaste)
        return true;
    const widget = document.querySelector(".fotoarhivs");
    if (!widget)
        return false;
    kaste = document.createElement("div");
    kaste.className = "reklama-skats";
    redzamais = createImg();
    nakamais = createImg();
    redzamais.style.transform = "translateY(0)";
    nakamais.style.transform = "translateY(100%)"; // gaida zem redzamās daļas
    kaste.append(redzamais, nakamais);
    widget.replaceChildren(kaste);
    return true;
}
function schedule() {
    clearTimeout(taimeris);
    taimeris = undefined;
    // Pārslīdēt vajag, ja ir vairāki attēli vai ja redzamais tika izdzēsts
    const vajag = saraksts.length > 1 || (pasreizejais !== null && !saraksts.includes(pasreizejais));
    if (vajag)
        taimeris = window.setTimeout(() => void parslidet(), periodsMs);
}
function nakamaisId() {
    const idx = pasreizejais ? saraksts.indexOf(pasreizejais) : -1;
    if (idx >= 0)
        return saraksts[(idx + 1) % saraksts.length];
    // Redzamais tika izdzēsts — rādām to, kas nostājās tā vietā
    return saraksts[Math.min(pedejaisIndekss, saraksts.length - 1)];
}
async function parslidet() {
    // Var tikt izsaukts arī ārpus taimera (piem. redzamais attēls izdzēsts) — tad gaidošais
    // taimeris jāatceļ, citādi paralēli sāktu darboties otrs cikls.
    clearTimeout(taimeris);
    taimeris = undefined;
    if (animacija || !kaste)
        return;
    const id = nakamaisId();
    if (!id || id === pasreizejais) {
        schedule();
        return;
    }
    animacija = true;
    const vecais = redzamais;
    const jaunais = nakamais;
    try {
        jaunais.src = reklamaUrl(id);
        await jaunais.decode(); // nekad neiebīdām pusielādētu attēlu
    }
    catch {
        // Bojāts vai pa to laiku izdzēsts attēls — izlaižam to
        pasreizejais = id;
        pedejaisIndekss = Math.max(0, saraksts.indexOf(id));
        animacija = false;
        schedule();
        return;
    }
    const opts = { duration: SLIDE_MS, easing: EASING };
    const a = vecais.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], opts);
    const b = jaunais.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], opts);
    // Beigu pozīcijas uzliekam uzreiz — animācija tās pārklāj, līdz beidzas, tāpēc nav mirgošanas
    vecais.style.transform = "translateY(100%)";
    jaunais.style.transform = "translateY(0)";
    await Promise.all([a.finished, b.finished]).catch(() => { });
    redzamais = jaunais;
    nakamais = vecais;
    pasreizejais = id;
    pedejaisIndekss = Math.max(0, saraksts.indexOf(id));
    animacija = false;
    schedule();
}
/** Jauni dati no servera (izsauc izmainas.ts, kad dati mainās). */
export function atjaunotReklamas(r) {
    if (!init())
        return;
    const vecaisPeriods = periodsMs;
    saraksts = (r?.atteli ?? []).map(a => a.id);
    periodsMs = Math.max(3, r?.periods ?? 10) * 1000;
    kaste.classList.toggle("tuksa", saraksts.length === 0);
    if (saraksts.length === 0) {
        clearTimeout(taimeris);
        taimeris = undefined;
        pasreizejais = null;
        if (!animacija)
            redzamais.removeAttribute("src");
        return;
    }
    if (pasreizejais === null) {
        // Pirmais attēls — parādām uzreiz, bez animācijas
        pasreizejais = saraksts[0];
        pedejaisIndekss = 0;
        redzamais.src = reklamaUrl(pasreizejais);
        schedule();
        return;
    }
    if (animacija)
        return; // pēc animācijas schedule() paņems jaunos datus pats
    if (!saraksts.includes(pasreizejais)) {
        void parslidet(); // redzamais izdzēsts — uzreiz uz nākamo
    }
    else if (periodsMs !== vecaisPeriods || taimeris === undefined) {
        schedule(); // mainīts periods, vai no viena attēla kļuva vairāki
    }
}
//# sourceMappingURL=reklamas.js.map