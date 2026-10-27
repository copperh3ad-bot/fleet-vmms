// The countdown shown while a free trial runs. Pure, so it is tested without a browser. It works on a number of milliseconds left (measured by the server and
// counted down in the browser), never on the device's own idea of the date, so a wrong clock on a phone cannot make a trial look longer or shorter.

export type Countdown = { done: boolean; days: number; hours: number; minutes: number; seconds: number; text: string; spoken: string; tone: "info" | "warn" | "bad" };

const pad = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function countdown(msLeft: number): Countdown {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const days = Math.floor(total / 86_400), hours = Math.floor((total % 86_400) / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const done = total === 0;
  // Ticking digits for the eye: days only while there are some, hours only while there are some, seconds always.
  const text = done ? "0 s" : days > 0 ? `${days} d ${pad(hours)} h ${pad(minutes)} m ${pad(seconds)} s` : hours > 0 ? `${hours} h ${pad(minutes)} m ${pad(seconds)} s` : `${minutes} m ${pad(seconds)} s`;
  // The sentence a screen reader hears, which changes only once a minute so it is not read out every second.
  const spoken = done ? "Your free trial has ended."
    : days > 0 ? `Your free trial ends in ${plural(days, "day")}, ${plural(hours, "hour")} and ${plural(minutes, "minute")}.`
    : hours > 0 ? `Your free trial ends in ${plural(hours, "hour")} and ${plural(minutes, "minute")}.`
    : `Your free trial ends in ${plural(Math.max(1, minutes + (seconds > 0 ? 1 : 0)), "minute")}.`;
  // Calm while there is time, a warning in the last day, urgent in the last hour.
  const tone = total <= 3600 ? "bad" : total <= 86_400 ? "warn" : "info";
  return { done, days, hours, minutes, seconds, text, spoken, tone };
}
