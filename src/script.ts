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

setClock();