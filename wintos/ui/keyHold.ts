// Holding ⌘ for half a second shows every key beside what it does; letting go hides them again.
// A ⌘ shortcut pressed at once (⌘J) shows nothing.
const HOLD_MS = 500;
const SHOWN = "w-show-keys";

let installed = false;
export function installKeyHold(): void {
    if (installed) return;
    installed = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => (clearTimeout(timer), (timer = undefined), document.body.classList.remove(SHOWN));
    window.addEventListener(
        "keydown",
        (e) => {
            if (e.key !== "Meta") return void (document.body.classList.contains(SHOWN) || (clearTimeout(timer), (timer = undefined)));
            if (!e.repeat && !timer) timer = setTimeout(() => document.body.classList.add(SHOWN), HOLD_MS);
        },
        true,
    );
    window.addEventListener("keyup", (e) => e.key === "Meta" && hide(), true);
    window.addEventListener("blur", hide);
}
