export const nowDescription = "The current date and time in Asia/Saigon. Call this before reasoning about dates or deadlines.";

export function now(at = new Date()): { iso: string; date: string; time: string; weekday: string; tz: string } {
  const tz = "Asia/Saigon";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long", hour12: false }).formatToParts(at).map((p) => [p.type, p.value]));
  const date = `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
  const hour = parts["hour"] === "24" ? "00" : parts["hour"];
  const time = `${hour}:${parts["minute"]}`;
  return { iso: `${date}T${time}:${parts["second"]}+07:00`, date, time, weekday: parts["weekday"] ?? "", tz };
}
