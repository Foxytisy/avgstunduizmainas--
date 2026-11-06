function setClock() {
    const now = new Date();
    const seconds = now.getSeconds();
    const minutes = now.getMinutes();
    const hours = now.getHours();

    const secondDeg = ((seconds / 60) * 360);
    const minuteDeg = ((minutes / 60) * 360);
    const hourDeg = ((hours / 12) * 360);

    document.getElementById("second-hand")!.style.transform = `rotate(${secondDeg}deg)`;
    //document.getElementById("minute-hand")!.style.transform = `rotate(${minuteDeg}deg)`;
    //document.getElementById("hour-hand")!.style.transform = `rotate(${hourDeg}deg)`;

    const secondHand = document.getElementById("second-hand")!;
    
    const anim = secondHand.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 60_000, iterations: Infinity, easing: "linear" }
    );

function sync() {
    const now = new Date();
    anim.currentTime = now.getSeconds() * 1000 + now.getMilliseconds();
}

sync();
setInterval(sync, 60_000);
document.addEventListener("visibilitychange", sync);

    console.log(secondDeg)
}

setInterval(setClock, 1000);
setClock();