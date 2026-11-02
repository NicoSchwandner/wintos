// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TermViewModel } from "@/app/view/term/term-model";
import { computeTheme } from "@/app/view/term/termutil";
import { lightSchemeAtom, paneGround } from "@/wintos/ui/scheme";
import { TermWrap } from "@/app/view/term/termwrap";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

interface TermThemeProps {
    blockId: string;
    termRef: React.RefObject<TermWrap>;
    model: TermViewModel;
}

const TermThemeUpdater = ({ blockId, model, termRef }: TermThemeProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const blockTermTheme = useAtomValue(model.termThemeNameAtom);
    const transparency = useAtomValue(model.termTransparencyAtom);
    const light = useAtomValue(lightSchemeAtom);
    const [theme, bg] = computeTheme(fullConfig, blockTermTheme, transparency, paneGround());
    useEffect(() => {
        if (termRef.current?.terminal) {
            termRef.current.terminal.options.theme = theme;
            termRef.current.setSchemeBg(bg);
        }
    }, [theme, bg, light]);
    return null;
};

export { TermThemeUpdater };
