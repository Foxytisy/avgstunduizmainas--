interface TableData {
    id: number;
    value: string;
};

interface Vardadienas {
    datums: string;
    vardadienas: string;
}

interface Quotes {
    quote: string;
    author: string;
}

const skip = (n: number): string => String(n).padStart(1, "0");

const vddb = new Map<string,string[]>();

const qdb = new Map<string,string>();

const weekDayTable: TableData[] = [
    { id: 1, value: "Pirmdiena" },
    { id: 2, value: "Otrdiena" },
    { id: 3, value: "Trešdiena" },
    { id: 4, value: "Ceturtdiena" },
    { id: 5, value: "Piektdiena" },
    { id: 6, value: "Sestdiena" },
    { id: 0, value: "Svētdiena" },
];

const monthTable: TableData[] = [
    { id: 0, value: "Janvāris" },
    { id: 1, value: "Februāris" },
    { id: 2, value: "Marts" },
    { id: 3, value: "Aprīlis" },
    { id: 4, value: "Maijs" },
    { id: 5, value: "Jūnijs" },
    { id: 6, value: "Jūlijs" },
    { id: 7, value: "Augusts" },
    { id: 8, value: "Septembris" },
    { id: 9, value: "Oktobris" },
    { id: 10, value: "Novembris" },
    { id: 11, value: "Decembris" },
];

function getData(table: TableData[], id: number): string | null {
    return table.find(item => item.id === id)?.value!!!!!!! //lol
}

function setDate() {
    const date = new Date();
    const day = date.getDate();
    const weekday = date.getDay();
    const month = date.getMonth();

    document.getElementById("date")!.textContent=day.toString();
    document.getElementById("month")!.textContent=getData(weekDayTable, weekday);
    document.getElementById("day")!.textContent=getData(monthTable, month);

    //šeit man liekas, ka vajag ielikt kaut kādu refresh lietu, lai viņš atjaunojas katru dienu
};

export async function loadVardadienas(url: string = "../assets/vardadienas.json"): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);

    const dienas: Vardadienas[] = await res.json();

    for (const row of dienas) {
        const [d, m] = row.datums.split(".").map(Number);
        const key = `${skip(d!)}.${skip(m!)}.`;
        const names = row.vardadienas
            .split(",")
            .map(n => n.trim())
            .filter(Boolean);
        vddb.set(key, [...(vddb.get(key) ?? []), ...names]);
};
}

export async function loadQuotes(url: string = "../assets/quotes.json"): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);

    const quotes: Quotes[] = await res.json();

    for (const row of quotes) {
        const quote = row.quote;
        const author = row.author;
        qdb.set(quote, author);
};
};



export function getQuotes(): string {
    const mapEntries = Array.from(qdb.entries());

    const rand = getRandomInt(0, qdb.size);
    console.log(rand)
    const [quote, author] = mapEntries[rand]!;

    return quote;
}

export function getAuthor(): string {
    const mapEntries = Array.from(qdb.entries());

    const rand = getRandomInt(0, qdb.size);
    console.log(rand)
    const [quote, author] = mapEntries[rand]!;

    return author;
}

function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getVardadienas(date: Date = new Date()): string[] {
    const key = `${skip(date.getDate())}.${skip(date.getMonth() + 1)}.`;
    const vardadienas = vddb.get(key) ?? [];
    //console.log(key);
    return vardadienas;
}

function setNames() {
    document.getElementById("names")!.textContent=getVardadienas().join(", ");
}

function setClock() {
    const now = new Date();
    const seconds = now.getSeconds();
    const minutes = now.getMinutes();
    const hours = now.getHours();

    const secondDeg = ((seconds / 60) * 360);
    const minuteDeg = ((minutes / 60) * 360);
    const hourDeg = ((hours / 12) * 360);

    document.getElementById("second-hand")!.style.transform = `rotate(${secondDeg}deg)`;
    document.getElementById("minute-hand")!.style.transform = `rotate(${minuteDeg}deg)`;
    document.getElementById("hour-hand")!.style.transform = `rotate(${hourDeg}deg)`;

    const secondHand = document.getElementById("second-hand")!;
    const minuteHand = document.getElementById("minute-hand")!;
    const hourHand = document.getElementById("hour-hand")!;
    
    const animsec = secondHand.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 60000, iterations: Infinity, easing: "linear" }
    );

    const animmin = minuteHand.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 3600000, iterations: Infinity, easing: "linear" }
    );

    const animh = hourHand.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 43200000, iterations: Infinity, easing: "linear" }
    );

function sync() { //vnk, lai neuzsprāgst dators (cerams) + smukumam
    const now = new Date();
    const ms = now.getMilliseconds();
    const s = now.getSeconds();
    const m = now.getMinutes();
    const h = now.getHours() % 12;

    animsec.currentTime = s * 1000 + ms;
    animmin.currentTime = (m * 60 + s) * 1000 + ms;
    animh.currentTime = ((h * 60 + m) * 60 + s) * 1000 + ms;

}

    sync();
    setInterval(sync, 60_000);
    document.addEventListener("visibilitychange", sync);
};

// Citāti

function setQuote() {
    document.getElementById("quotes")!.textContent=`"${getQuotes()}"`;
    document.getElementById("author")!.textContent=`-${getAuthor()}`;
};

loadVardadienas().then(setNames).catch(console.error);
loadQuotes().then(setQuote).catch(console.error);
setClock();
setDate();