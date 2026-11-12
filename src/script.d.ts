interface Quotes {
    quoteText: string;
    quoteAuthor: string;
}
export declare function loadVardadienas(url?: string): Promise<void>;
export declare function loadQuotes(url?: string): Promise<void>;
export declare function getQuote(): Quotes;
export declare function getVardadienas(date?: Date): string[];
export {};
//# sourceMappingURL=script.d.ts.map