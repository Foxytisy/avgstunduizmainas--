;
const skip = (n) => String(n).padStart(1, "0");
const db = new Map();
const weekDayTable = [
    { id: 1, value: "Pirmdiena" },
    { id: 2, value: "Otrdiena" },
    { id: 3, value: "Trešdiena" },
    { id: 4, value: "Ceturtdiena" },
    { id: 5, value: "Piektdiena" },
    { id: 6, value: "Sestdiena" },
    { id: 7, value: "Svētdiena" },
];
const monthTable = [
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
function getData(table, id) {
    return table.find(item => item.id === id)?.value; //lol
}
function setDate() {
    const date = new Date();
    const day = date.getDate();
    const weekday = date.getDay();
    const month = date.getMonth();
    document.getElementById("date").textContent = day.toString();
    document.getElementById("month").textContent = getData(weekDayTable, weekday);
    document.getElementById("day").textContent = getData(monthTable, month);
    //šeit man liekas, ka vajag ielikt kaut kādu refresh lietu, lai viņš atjaunojas katru dienu
}
;
export async function loadVardadienas(url = "../assets/vardadienas.json") {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Failed to load ${url}: ${res.status}`);
    const dienas = await res.json();
    for (const row of dienas) {
        const [d, m] = row.datums.split(".").map(Number);
        const key = `${skip(d)}.${skip(m)}.`;
        const names = row.vardadienas
            .split(",")
            .map(n => n.trim())
            .filter(Boolean);
        db.set(key, [...(db.get(key) ?? []), ...names]);
    }
    ;
}
export function getVardadienas(date = new Date()) {
    const key = `${skip(date.getDate())}.${skip(date.getMonth() + 1)}.`;
    const vardadienas = db.get(key) ?? [];
    //console.log(key);
    return vardadienas;
}
function setNames() {
    document.getElementById("names").textContent = getVardadienas().join(", ");
}
function setClock() {
    const now = new Date();
    const seconds = now.getSeconds();
    const minutes = now.getMinutes();
    const hours = now.getHours();
    const secondDeg = ((seconds / 60) * 360);
    const minuteDeg = ((minutes / 60) * 360);
    const hourDeg = ((hours / 12) * 360);
    document.getElementById("second-hand").style.transform = `rotate(${secondDeg}deg)`;
    document.getElementById("minute-hand").style.transform = `rotate(${minuteDeg}deg)`;
    document.getElementById("hour-hand").style.transform = `rotate(${hourDeg}deg)`;
    const secondHand = document.getElementById("second-hand");
    const minuteHand = document.getElementById("minute-hand");
    const hourHand = document.getElementById("hour-hand");
    const animsec = secondHand.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 60000, iterations: Infinity, easing: "linear" });
    const animmin = minuteHand.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 3600000, iterations: Infinity, easing: "linear" });
    const animh = hourHand.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 43200000, iterations: Infinity, easing: "linear" });
    function sync() {
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
}
loadVardadienas().then(setNames).catch(console.error);
setClock();
setDate();
//# sourceMappingURL=script.js.map