import { useEffect, useRef } from "react";

// Focus once when a view opens. A ref callback written inline is a new function on every
// render, so React re-invokes it and steals focus back from inputs and web views.
export function useFocusOnMount<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    useEffect(() => ref.current?.focus(), []);
    return ref;
}
