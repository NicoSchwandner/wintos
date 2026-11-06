// What to call the day the plan builds on: "Yesterday" only when it was, its weekday within the
// week, "Last Friday" across a weekend, else its date.
export function lastDayName(lastIso: string, todayIso: string): string {
    const last = new Date(`${lastIso}T12:00:00`);
    const today = new Date(`${todayIso}T12:00:00`);
    const days = Math.round((today.getTime() - last.getTime()) / 86_400_000);
    const weekday = last.toLocaleDateString("en-GB", { weekday: "long" });
    const monday = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    if (days === 1) return "Yesterday";
    if (monday(last) === monday(today)) return weekday;
    if (days < 7) return `Last ${weekday}`;
    return last.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}
