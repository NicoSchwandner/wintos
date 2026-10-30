import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

// Whether the system shows its light appearance now; it changes when System Settings switches.
const query = window.matchMedia("(prefers-color-scheme: light)");
export const lightSchemeAtom = atom(query.matches);
query.addEventListener("change", (e) => globalStore.set(lightSchemeAtom, e.matches));

// The WintOS terminal theme has a light twin, used while the system is light.
export const schemeTermTheme = (name: string, light: boolean) => (name === "wintos" && light ? "wintos-light" : name);
