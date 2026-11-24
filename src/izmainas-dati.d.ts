export interface Stunda {
    nosaukums: string;
    kabinets: string;
}
/** null = šajā laikā stundas nav */
export type Ieraksts = Stunda | null;
export interface Reklama {
    /** Faila nosaukums serverī, piem. "3f9a1c2b7d4e5f60.webp" */
    id: string;
    /** Sākotnējais faila nosaukums (tikai dashboard) */
    nosaukums: string;
}
export interface Reklamas {
    /** Cik sekundes rāda katru attēlu */
    periods: number;
    /** Rādīšanas secībā */
    atteli: Reklama[];
}
export declare const REKLAMU_URL = "/api/reklamas";
export declare const PARKLAJUMU_URL = "/api/parklajumi";
export interface Parklajums {
    /** Faila nosaukums serverī */
    id: string;
    /** Sākotnējais faila nosaukums */
    nosaukums: string;
    /** 10…100 % */
    necaurspidigums: number;
}
export interface Tema {
    parklajums: Parklajums | null;
}
export declare const PRIEKSSKATS_ZINA = "tema-prieksskats";
export declare function parklajumaUrl(id: string): string;
export declare function reklamaUrl(id: string): string;
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
    /** Reklāmu attēli "Fotoarhīvs" widgetā */
    reklamas: Reklamas;
    /** Displeja krāsas un pārklājums */
    tema: Tema;
}
/** Cik dienas atpakaļ glabā izmaiņas (= GLABA_DIENAS server.mjs) */
export declare const GLABA_DIENAS = 31;
export declare const DIENAS: string[];
export declare const API_URL = "/api/izmainas";
export declare class KonfliktaKluda extends Error {
    readonly dati: IzmainuDati;
    constructor(dati: IzmainuDati);
}
export declare function loadIzmainas(signal?: AbortSignal): Promise<IzmainuDati>;
export declare function saveIzmainas(dati: IzmainuDati, signal?: AbortSignal): Promise<IzmainuDati>;
/** fetch ar noildzi — taimeris vienmēr tiek notīrīts */
export declare function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
/** Datums kā "YYYY-MM-DD" (vietējā laikā) — tā glabā datus un <input type="date">. */
export declare function todayKey(date?: Date): string;
export declare function parseDatums(datums: string): Date;
/** "2026-11-23" -> "1" (pirmdiena). Atslēga pamatplānā. */
export declare function weekdayOf(datums: string): string;
export declare function addDays(datums: string, n: number): string;
/** "2026-11-23" -> "23/11/2026" */
export declare function formatDatums(datums: string): string;
export declare function parseKlase(nosaukums: string): {
    grade: number;
    letter: string;
} | null;
export declare function sortKlases(klases: string[]): string[];
export declare function sameStunda(a: Ieraksts | undefined, b: Ieraksts | undefined): boolean;
export declare function stundaText(s: Ieraksts): string;
/** Pastāvīgā stunda tajā nedēļas dienā, kurā ir šis datums. */
export declare function getBase(dati: IzmainuDati, datums: string, klase: string, i: number): Ieraksts;
export declare function hasIzmaina(dati: IzmainuDati, datums: string, klase: string, i: number): boolean;
/** Stunda, kas notiek šajā datumā: izmaiņa, ja tāda ir, citādi pamatplāns. */
export declare function getStunda(dati: IzmainuDati, datums: string, klase: string, i: number): {
    stunda: Ieraksts;
    mainita: boolean;
};
export declare function klasesArIzmainam(dati: IzmainuDati, datums: string): string[];
export declare function formatAtjaunots(ms: number, now?: number): string;
export declare function createClassNumber(klase: string): HTMLDivElement;
/**
 * skats "izmainas" — rāda stundu šajā datumā (izmaiņas sarkanā rāmī);
 * skats "pamatplans" — rāda pastāvīgo plānu (izmantots dashboard).
 */
export declare function createClassContainer(dati: IzmainuDati, datums: string, klase: string, i: number, skats?: "izmainas" | "pamatplans"): HTMLDivElement;
//# sourceMappingURL=izmainas-dati.d.ts.map