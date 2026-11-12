// A textarea that grows with its text, so the page around it scrolls rather than a small box.
export function fitHeight(t: HTMLTextAreaElement, min: number): void {
    t.style.height = "auto";
    t.style.height = `${Math.max(min, t.scrollHeight + 2)}px`;
}

// The caret's line, fully in view with a line to spare, in whatever scrolls around the field. A
// browser only brings the caret itself into view, and only inside the field: a half-cut line, or a
// grown field whose caret sits below the page's edge, stays that way.
export function revealCaret(t: HTMLTextAreaElement): void {
    const s = getComputedStyle(t);
    const line = parseFloat(s.lineHeight) || 20;
    // A copy of the text up to the caret, wrapped as the field wraps it, says where the caret is.
    const mirror = document.createElement("div");
    for (const p of ["fontFamily", "fontSize", "lineHeight", "letterSpacing", "paddingTop", "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth", "boxSizing", "tabSize"] as const) mirror.style[p] = s[p];
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", width: `${t.clientWidth}px`, top: "0", left: "-9999px" });
    mirror.textContent = t.value.slice(0, t.selectionEnd);
    const mark = mirror.appendChild(document.createElement("span"));
    mark.textContent = "​";
    document.body.appendChild(mirror);
    const y = mark.offsetTop;
    mirror.remove();
    const box = t.getBoundingClientRect();
    const top = box.top + y - t.scrollTop - line;
    const bottom = box.top + y - t.scrollTop + 2 * line;
    for (let el = t.parentElement; el; el = el.parentElement) {
        if (el.scrollHeight <= el.clientHeight || !/auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
        const view = el.getBoundingClientRect();
        if (top < view.top) el.scrollTop -= view.top - top;
        else if (bottom > view.bottom) el.scrollTop += bottom - view.bottom;
        return;
    }
}
