export function waitingAgents(agents, waits) {
    const waiting = new Map(waits.map((w) => [w.terminal, w]));
    return agents.map((a) => {
        const wait = waiting.get(a.address);
        if (!wait || a.status === "working" || a.status === "blocked") return a;
        return { ...a, status: "waiting", waitReason: `${wait.event}: ${wait.target}` };
    });
}
