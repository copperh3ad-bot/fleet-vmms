// The Fleet OTG logo. Both files are in /public (light-on-dark artwork with a transparent background), so use them on the dark
// header, sidebar and brand panel only.
/* eslint-disable @next/next/no-img-element */

/** The full logo (mark, name and tagline). Pass the height in px; the width follows (4:1). */
export function Logo({ height = 40, className }: { height?: number; className?: string }) {
  return <img src="/fleetotg-logo.png" alt="Fleet OTG, your fleet manager" width={height * 4} height={height} className={className} style={{ height, width: "auto", alignSelf: "flex-start" }} />;
}

/** The mark alone, for tight spaces. */
export function LogoMark({ height = 28, className }: { height?: number; className?: string }) {
  return <img src="/fleetotg-icon.png" alt="Fleet OTG" width={Math.round(height * 4 / 3)} height={height} className={className} style={{ height, width: "auto", alignSelf: "flex-start" }} />;
}
