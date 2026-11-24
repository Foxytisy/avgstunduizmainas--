// Tēmas krāsas: no 4 izvēlētām krāsām izveido visus CSS mainīgos (style.css :root),
// un pārbauda, vai teksts paliek lasāms (WCAG kontrasts).
// Izmanto gan TV (tema.ts), gan dashboard (priekšskatījums un pārbaudes) — tāpēc tie vienmēr sakrīt.

export interface TemasKrasas {
    /** Izmaiņu rāmji, nedēļas diena, sekunžu rādītājs */
    akcents: string;
    /** Lapas fons ap lielo paneli */
    fons: string;
    /** Lielais noapaļotais panelis un klases numura fons */
    panelis: string;
    /** Logrīku un stundu šūnu fons */
    logriki: string;
}

/** postMessage tips, ar kuru dashboard sūta nesaglabāto tēmu TV priekšskatījumam (iframe). */
export const PRIEKSSKATS_ZINA = "tema-prieksskats";

/** CSS mainīgie, ko tēma pārraksta (style.css :root). Atjaunojot noklusējumu, tos noņem. */
export const TEMAS_MAINIGIE = [
    "--accent", "--accent-dark", "--accent-soft",
    "--dark", "--backdrop",
    "--surface", "--widget", "--cell",
    "--gray", "--gray-light",
] as const;

/** Prasības (WCAG): tekstam ≥ 4.5:1; logrīkiem 7:1, lai fons būtu tiešām gaišs (pulksteņa ciparnīca ir melna);
 *  akcentam (rāmji, lieli virsraksti) ≥ 3:1. */
export const PRASIBAS = { logriki: 7, panelis: 4.5, akcents: 3 } as const;

const TEKSTS = "#000000";

interface RGB { r: number; g: number; b: number }

function hexToRgb(hex: string): RGB {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: RGB): string {
    return "#" + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/** t = 0 → a, t = 1 → b */
function mix(a: string, b: string, t: number): string {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

function luminance(hex: string): number {
    const { r, g, b } = hexToRgb(hex);
    const lin = (v: number): number => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG kontrasta attiecība, 1…21 */
export function kontrasts(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
}

export function irKrasa(v: unknown): v is string {
    return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

export interface Parbaude {
    logriki: number;  // melns teksts uz logrīkiem
    panelis: number;  // melns teksts uz paneļa (klases numuri)
    akcents: number;  // akcents uz logrīkiem
    derigs: boolean;
}

export function parbaudit(k: TemasKrasas): Parbaude {
    const logriki = kontrasts(TEKSTS, k.logriki);
    const panelis = kontrasts(TEKSTS, k.panelis);
    const akcents = kontrasts(k.akcents, k.logriki);
    return {
        logriki, panelis, akcents,
        derigs: logriki >= PRASIBAS.logriki && panelis >= PRASIBAS.panelis && akcents >= PRASIBAS.akcents,
    };
}

/** Pietuvina krāsu `uz` mazos soļos, līdz kontrasts pret `pret` sasniedz `merkis`. */
function lidzKontrastam(krasa: string, uz: string, pret: string, merkis: number): string {
    for (let t = 0; t <= 1.0001; t += 0.02) {
        const c = mix(krasa, uz, t);
        if (kontrasts(c, pret) >= merkis) return c;
    }
    return uz;
}

/** Izlabo krāsas tā, lai visas pārbaudes izietu: gaišina fonus, tumšina akcentu. Toni saglabā. */
export function labotKontrastu(k: TemasKrasas): TemasKrasas {
    const logriki = lidzKontrastam(k.logriki, "#ffffff", TEKSTS, PRASIBAS.logriki + 0.05);
    const panelis = lidzKontrastam(k.panelis, "#ffffff", TEKSTS, PRASIBAS.panelis + 0.05);
    const akcents = lidzKontrastam(k.akcents, "#000000", logriki, PRASIBAS.akcents + 0.05);
    return { ...k, logriki, panelis, akcents };
}

/** Visi CSS mainīgie šai tēmai. Pelēkos toņus izvēlas tā, lai tie būtu lasāmi uz logrīku fona. */
export function temasMainigie(k: TemasKrasas): Record<(typeof TEMAS_MAINIGIE)[number], string> {
    const { r, g, b } = hexToRgb(k.akcents);
    const f = hexToRgb(k.fons);
    return {
        "--accent": k.akcents,
        "--accent-dark": mix(k.akcents, "#000000", 0.18),
        "--accent-soft": `rgba(${r}, ${g}, ${b}, 0.1)`,
        "--dark": k.fons,
        "--backdrop": `rgba(${f.r}, ${f.g}, ${f.b}, 0.6)`,
        "--surface": k.panelis,
        "--widget": k.logriki,
        "--cell": k.logriki,
        // pelēkie: virsraksti "Vārdadienu svin:", rāmji, paskaidrojumi — tonēti ar logrīku krāsu
        "--gray": lidzKontrastam(mix(k.logriki, TEKSTS, 0.35), TEKSTS, k.logriki, 4.5),
        "--gray-light": lidzKontrastam(mix(k.logriki, TEKSTS, 0.2), TEKSTS, k.logriki, 3),
    };
}

/** Sākotnējās krāsas (style.css :root) — dashboard krāsu laukiem, kad tēma nav izvēlēta. */
export const NOKLUSEJUMS: TemasKrasas = { akcents: "#d71e1e", fons: "#202020", panelis: "#e8e8e8", logriki: "#f8f8f8" };
