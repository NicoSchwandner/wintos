// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from "electron";

document.addEventListener("contextmenu", (event) => {
    console.log("contextmenu event", event);
    if (event.target == null) {
        return;
    }
    const targetElement = event.target as HTMLElement;
    // Check if the right-click is on an image
    if (targetElement.tagName === "IMG") {
        setTimeout(() => {
            if (event.defaultPrevented) {
                return;
            }
            event.preventDefault();
            const imgElem = targetElement as HTMLImageElement;
            const imageUrl = imgElem.src;
            ipcRenderer.send("webview-image-contextmenu", { src: imageUrl });
        }, 50);
        return;
    }
    // do nothing
});

document.addEventListener("mouseup", (event) => {
    // Mouse button 3 = back, button 4 = forward
    if (!event.isTrusted) {
        return;
    }
    if (event.button === 3 || event.button === 4) {
        event.preventDefault();
        ipcRenderer.send("webview-mouse-navigate", event.button === 3 ? "back" : "forward");
    }
});

// WintOS: a press in the page, so the host can tell your click from the page taking focus by
// itself (wintos/ui/focusOwner.ts).
document.addEventListener(
    "pointerdown",
    (event) => {
        if (event.isTrusted) ipcRenderer.sendToHost("wintos-page-pressed");
    },
    true
);

// WintOS: a page never passes the ⌘ release to the host, which ends a ⌘J/⌘K walk
// (wintos/ui/switcher.ts).
window.addEventListener(
    "keyup",
    (event) => {
        if (event.isTrusted && event.key === "Meta") ipcRenderer.sendToHost("wintos-meta-up");
    },
    true
);

// WintOS: whether what has focus here takes text, so the host leaves the page its editing keys
// (Esc, ⌘⏎, ⌘K, ⌘E, ⌘I, ⌘B, ⇧⌘P) while you type in it (emain-ipc.ts).
const takesText = (el: Element | null) =>
    !!el && (el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable || (el.tagName === "INPUT" && !["button", "checkbox", "radio", "submit", "reset", "file", "image", "range", "color"].includes((el as HTMLInputElement).type)));
let editing = false;
const reportEditing = () => {
    const now = takesText(document.activeElement);
    if (now === editing) return;
    editing = now;
    ipcRenderer.send("wintos-page-editing", now);
};
document.addEventListener("focusin", reportEditing, true);
document.addEventListener("focusout", () => setTimeout(reportEditing, 0), true);

console.log("loaded wave preload-webview.ts");
