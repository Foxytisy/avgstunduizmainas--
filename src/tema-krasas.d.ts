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
export declare const PRIEKSSKATS_ZINA = "tema-prieksskats";
/** CSS mainīgie, ko tēma pārraksta (style.css :root). Atjaunojot noklusējumu, tos noņem. */
export declare const TEMAS_MAINIGIE: readonly ["--accent", "--accent-dark", "--accent-soft", "--dark", "--backdrop", "--surface", "--widget", "--cell", "--gray", "--gray-light"];
/** Prasības (WCAG): tekstam ≥ 4.5:1; logrīkiem 7:1, lai fons būtu tiešām gaišs (pulksteņa ciparnīca ir melna);
 *  akcentam (rāmji, lieli virsraksti) ≥ 3:1. */
export declare const PRASIBAS: {
    readonly logriki: 7;
    readonly panelis: 4.5;
    readonly akcents: 3;
};
/** WCAG kontrasta attiecība, 1…21 */
export declare function kontrasts(a: string, b: string): number;
export declare function irKrasa(v: unknown): v is string;
export interface Parbaude {
    logriki: number;
    panelis: number;
    akcents: number;
    derigs: boolean;
}
export declare function parbaudit(k: TemasKrasas): Parbaude;
/** Izlabo krāsas tā, lai visas pārbaudes izietu: gaišina fonus, tumšina akcentu. Toni saglabā. */
export declare function labotKontrastu(k: TemasKrasas): TemasKrasas;
/** Visi CSS mainīgie šai tēmai. Pelēkos toņus izvēlas tā, lai tie būtu lasāmi uz logrīku fona. */
export declare function temasMainigie(k: TemasKrasas): Record<(typeof TEMAS_MAINIGIE)[number], string>;
/** Sākotnējās krāsas (style.css :root) — dashboard krāsu laukiem, kad tēma nav izvēlēta. */
export declare const NOKLUSEJUMS: TemasKrasas;
//# sourceMappingURL=tema-krasas.d.ts.map