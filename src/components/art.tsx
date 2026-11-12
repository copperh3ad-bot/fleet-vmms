import { useId, type ReactNode } from "react";

// Illustrations for the public pages: one scene per feature, drawn inline so there is nothing to download and no script to run. They are pictures of the product's
// ideas (an approval stamp, a phone link, a reminder), not live data and not screenshots, and carry no figures. Decorative: hidden from assistive technology, because
// the text beside each one says the same thing. Each scene has ONE focal object, large and lit; everything around it is quiet. Labels are few, in sentence case and
// big enough to read once the picture is scaled. Motion is only an answer to the visitor: the dashed lines and the scan move while the picture is hovered (css in
// globals.css, off for visitors who ask for less motion). Gradient and shadow ids are unique per picture so a page can hold many.
const INK = "#10151a", MUTE = "#9fb1bc", SOFT = "#e6eaed", LINE = "rgba(255,255,255,.16)";

type K = { gold: string; ember: string; mint: string; paper: string; shadow: string };
const kit = (u: string): K => ({ gold: `url(#${u}gold)`, ember: `url(#${u}ember)`, mint: `url(#${u}mint)`, paper: `url(#${u}paper)`, shadow: `url(#${u}shadow)` });

function Frame({ u, children }: { u: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 150" className="h-full w-full" aria-hidden="true" focusable="false" role="presentation">
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1f262d" /><stop offset="1" stopColor="#0e1216" /></linearGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd75e" /><stop offset="1" stopColor="#f5a800" /></linearGradient>
        <linearGradient id={`${u}ember`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e8571a" /><stop offset="1" stopColor="#b53a08" /></linearGradient>
        <linearGradient id={`${u}mint`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3fc58a" /><stop offset="1" stopColor="#1f8a5b" /></linearGradient>
        <linearGradient id={`${u}paper`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#e9edf0" /></linearGradient>
        <radialGradient id={`${u}glow`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ffb300" stopOpacity=".3" /><stop offset="1" stopColor="#ffb300" stopOpacity="0" /></radialGradient>
        <filter id={`${u}shadow`} x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="4.5" floodColor="#000" floodOpacity=".42" /></filter>
      </defs>
      <rect width="240" height="150" fill={`url(#${u}bg)`} />
      <ellipse cx="120" cy="78" rx="104" ry="64" fill={`url(#${u}glow)`} />
      {children}
    </svg>
  );
}

const T = ({ x, y, s = 8, c = INK, w = 600, a = "start", children }: { x: number; y: number; s?: number; c?: string; w?: number; a?: "start" | "middle" | "end"; children: ReactNode }) =>
  <text x={x} y={y} fontSize={s} fill={c} fontWeight={w} textAnchor={a} fontFamily="'IBM Plex Sans', Arial, Helvetica, sans-serif">{children}</text>;
const Lines = ({ x, y, w = 60, n = 3, c = SOFT, gap = 9 }: { x: number; y: number; w?: number; n?: number; c?: string; gap?: number }) =>
  <>{Array.from({ length: n }, (_, i) => <rect key={i} x={x} y={y + i * gap} width={i === n - 1 ? w * 0.62 : w} height="4" rx="2" fill={c} />)}</>;
const Paper = ({ k, x, y, w, h, r = 9, children }: { k: K; x: number; y: number; w: number; h: number; r?: number; children?: ReactNode }) =>
  <g><rect x={x} y={y} width={w} height={h} rx={r} fill={k.paper} filter={k.shadow} />{children}</g>;
const Glass = ({ x, y, w, h, r = 10, stroke = LINE, children }: { x: number; y: number; w: number; h: number; r?: number; stroke?: string; children?: ReactNode }) =>
  <g><rect x={x} y={y} width={w} height={h} rx={r} fill="#fff" fillOpacity=".06" stroke={stroke} />{children}</g>;
const Tick = ({ k, x, y, r = 8 }: { k: K; x: number; y: number; r?: number }) => <g><circle cx={x} cy={y} r={r} fill={k.mint} /><path d={`M${x - r * 0.45} ${y} l${r * 0.3} ${r * 0.35} l${r * 0.6} -${r * 0.7}`} stroke="#fff" strokeWidth={r * 0.26} fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>;
const Person = ({ k, x, y, ember = false }: { k: K; x: number; y: number; ember?: boolean }) => <g><circle cx={x} cy={y} r="8" fill={ember ? k.ember : k.gold} /><circle cx={x} cy={y - 2.2} r="2.8" fill={INK} /><path d={`M${x - 4.8} ${y + 5.6} a4.8 4.2 0 0 1 9.6 0`} fill={INK} /></g>;
const Btn = ({ k, x, y, w, h = 15, children }: { k: K; x: number; y: number; w: number; h?: number; children: ReactNode }) =>
  <g><rect x={x} y={y} width={w} height={h} rx={h / 2} fill={k.ember} /><T x={x + w / 2} y={y + h * 0.7} s={7.6} c="#fff" a="middle" w={600}>{children}</T></g>;
const Pill = ({ x, y, w = 84, label, c }: { x: number; y: number; w?: number; label: string; c: string }) =>
  <g transform={`translate(${x} ${y})`}><Glass x={0} y={0} w={w} h={24} r={12} stroke={c} /><circle cx="13" cy="12" r="4.4" fill={c} /><T x={25} y={15.4} s={8.2} c="#fff">{label}</T></g>;
const Arrow = ({ x, y, w = 22 }: { x: number; y: number; w?: number }) =>
  <g><path d={`M${x} ${y} H${x + w}`} stroke="#ffc20e" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="4 4" className="art-flow" /><path d={`M${x + w - 5} ${y - 5.5} l6 5.5 l-6 5.5`} stroke="#ffc20e" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>;
const Car = ({ k, x, y, c, s = 1 }: { k: K; x: number; y: number; c?: string; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 14 L3.4 6 Q4.6 2 9 2 H21 Q25 2 27 6 L31 14 Z" fill={c ?? k.ember} /><rect x="-2" y="12" width="37" height="8.4" rx="3.4" fill={c ?? k.ember} />
    <path d="M7 4.6 H14 V9.6 H5.4 Z M16 4.6 H23 L25 9.6 H16 Z" fill={INK} opacity=".55" />
    <circle cx="7" cy="21" r="3.9" fill={INK} stroke="#fff" strokeWidth="1.2" /><circle cx="26" cy="21" r="3.9" fill={INK} stroke="#fff" strokeWidth="1.2" />
  </g>
);

const SCENES: Record<string, (k: K) => ReactNode> = {
  approve: (k) => (<>
    <Paper k={k} x={22} y={18} w={120} h={116}>
      <rect x="34" y="30" width="48" height="8" rx="4" fill={INK} /><Lines x={34} y={48} w={96} n={3} />
      <g transform="rotate(-10 84 104)"><rect x="38" y="86" width="92" height="30" rx="5" fill="#c2410c" fillOpacity=".07" stroke="#c2410c" strokeWidth="2.6" /><T x={84} y={107} s={14} c="#c2410c" a="middle" w={700}>Approved</T></g>
    </Paper>
    <path d="M146 52 H160 M146 98 H160" stroke="#ffc20e" strokeWidth="2" strokeDasharray="3 3" className="art-flow" />
    <Glass x={158} y={34} w={76} h={34}><Person k={k} x={173} y={51} /><T x={187} y={49} s={7.4} c={MUTE}>Raised by</T><rect x="187" y="55" width="30" height="4" rx="2" fill={SOFT} /></Glass>
    <Glass x={158} y={82} w={76} h={34} stroke="#e8571a"><Person k={k} x={173} y={99} ember /><T x={187} y={97} s={7.4} c={MUTE}>Approved by</T><rect x="187" y="103" width="26" height="4" rx="2" fill={SOFT} /></Glass>
  </>),
  quote: (k) => (<>
    <Paper k={k} x={14} y={26} w={92} h={100}><T x={26} y={45} s={10} c="#c2410c" w={700}>Quote</T><Lines x={26} y={56} w={68} n={3} /><rect x="26" y="90" width="58" height="16" rx="5" fill={INK} /><T x={34} y={101.6} s={8.6} c="#ffc20e">Rs ••••</T></Paper>
    <Paper k={k} x={134} y={26} w={92} h={100}><T x={146} y={45} s={10} c={INK} w={700}>Invoice</T><Lines x={146} y={56} w={68} n={3} /><rect x="146" y="90" width="58" height="16" rx="5" fill={INK} /><T x={154} y={101.6} s={8.6} c="#ffc20e">Rs ••••</T></Paper>
    <circle cx="120" cy="76" r="15" fill={k.gold} filter={k.shadow} /><path d="M112 72 H128 M112 80 H128" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
  </>),
  phone: (k) => (<>
    <rect x="82" y="8" width="76" height="134" rx="15" fill="#e9eef1" filter={k.shadow} />
    <rect x="88.5" y="19" width="63" height="112" rx="8.5" fill="#161c22" />
    <T x={120} y={37} s={7.6} c={MUTE} a="middle">Odometer</T><rect x="95" y="43" width="50" height="23" rx="6" fill="#0c1014" stroke={LINE} /><T x={120} y={59.5} s={13} c="#ffc20e" a="middle" w={700}>48210</T><T x={120} y={78} s={7.6} c={MUTE} a="middle">km</T>
    <Btn k={k} x={96} y={87} w={48} h={17}>Send</Btn><rect x="108" y="119" width="24" height="3" rx="1.5" fill="#fff" opacity=".25" />
    <g transform="translate(10 56)"><Glass x={0} y={0} w={58} h={30} r={15} stroke="#ffc20e" /><rect x="13" y="9.5" width="15" height="11" rx="5.5" fill="none" stroke="#ffc20e" strokeWidth="2.2" /><rect x="30" y="9.5" width="15" height="11" rx="5.5" fill="none" stroke="#ffc20e" strokeWidth="2.2" /><path d="M25 15 h8" stroke="#ffc20e" strokeWidth="2.2" /></g>
    <Tick k={k} x={198} y={72} r={12} />
  </>),
  bell: (k) => (<>
    <Paper k={k} x={16} y={26} w={100} h={102}><path d="M16 35 a9 9 0 0 1 9 -9 h82 a9 9 0 0 1 9 9 v12 h-100 z" fill={k.ember} /><rect x="38" y="19" width="5" height="13" rx="2.5" fill={INK} /><rect x="90" y="19" width="5" height="13" rx="2.5" fill={INK} />
      {Array.from({ length: 15 }, (_, i) => <circle key={i} cx={33 + (i % 5) * 17} cy={65 + Math.floor(i / 5) * 18} r="3.6" fill={i === 8 ? "#f5a800" : "#d7dde1"} />)}<circle cx="67" cy="83" r="9" fill="none" stroke="#c2410c" strokeWidth="2.4" /></Paper>
    <path d="M176 36 q-27 5 -27 34 v18 l-10 12 h74 l-10 -12 V70 q0 -29 -27 -34 z" fill={k.gold} filter={k.shadow} /><circle cx="176" cy="109" r="7.4" fill={k.gold} /><path d="M160 58 q5 -12 17 -14" stroke="#fff" strokeOpacity=".6" strokeWidth="3" fill="none" strokeLinecap="round" />
    <circle cx="208" cy="40" r="11" fill={k.ember} stroke="#10151a" strokeWidth="2.4" /><T x={208} y={44} s={12} c="#fff" a="middle" w={700}>3</T>
  </>),
  budget: (k) => (<>
    <path d="M24 128 H224" stroke="#fff" strokeOpacity=".22" strokeWidth="1.6" />
    {[46, 64, 54, 82, 68, 102, 78, 72].map((h, i) => <g key={i}><rect x={34 + i * 23} y={128 - h} width="17" height={h} rx="4.4" fill={i === 5 ? k.gold : k.ember} opacity={i === 5 ? 1 : 0.9} /></g>)}
    <path d="M24 54 H226" stroke="#fff" strokeWidth="1.6" strokeDasharray="5 4" opacity=".7" /><T x={30} y={47} s={8} c={MUTE}>Budget</T>
    <g transform="translate(150 20)"><path d="M0 0 V26" stroke="#ffc20e" strokeWidth="2.4" strokeLinecap="round" /><path d="M0 1 H22 L16 7.4 L22 14 H0" fill={k.gold} /></g>
  </>),
  papers: (k) => (<>
    {[0, 1, 2].map((i) => (<g key={i} transform={`translate(${18 + i * 22} ${18 + i * 16})`}>{i === 2 ? <Paper k={k} x={0} y={0} w={120} h={72} /> : <rect width="120" height="72" rx="9" fill="#dfe4e8" opacity={i === 0 ? 0.45 : 0.7} />}<rect x="12" y="11" width="44" height="7" rx="3.5" fill={INK} opacity={i === 2 ? 1 : 0.3} /></g>))}
    <T x={64} y={80} s={10} c={INK} w={700}>Insurance</T><Lines x={64} y={90} w={78} n={2} />
    <Pill x={162} y={22} w={68} label="Fitness" c="#3fc58a" /><Pill x={162} y={56} w={68} label="Token tax" c="#ffc20e" /><Pill x={162} y={90} w={68} label="Licence" c="#e8571a" />
  </>),
  departments: (k) => (<>
    {[["Logistics", 12, 16, "#ffc20e", k.gold], ["Operations", 128, 16, "#e8571a", k.ember], ["Sales", 70, 82, "#3fc58a", k.mint]].map(([n, x, y, c, g]) => (
      <g key={String(n)} transform={`translate(${x} ${y})`}><Glass x={0} y={0} w={100} h={60} r={12} stroke={String(c)} /><T x={11} y={17} s={8.4} c={String(c)} w={700}>{String(n)}</T><Car k={k} x={11} y={26} c={String(g)} s={0.88} /><Car k={k} x={50} y={26} c={String(g)} s={0.88} /><rect x="11" y="51" width="78" height="3.6" rx="1.8" fill="#fff" opacity=".14" /><rect x="11" y="51" width={n === "Sales" ? 22 : 52} height="3.6" rx="1.8" fill={String(g)} /></g>
    ))}
  </>),
  request: (k) => (<>
    <Paper k={k} x={12} y={20} w={90} h={110}><T x={23} y={39} s={9} c={INK} w={700}>Request</T><Person k={k} x={32} y={59} ember /><rect x="45" y="55" width="46" height="4.4" rx="2.2" fill={SOFT} /><Lines x={23} y={76} w={68} n={3} /><Btn k={k} x={23} y={108} w={48} h={15}>Send</Btn></Paper>
    <Arrow x={108} y={75} w={22} />
    <Paper k={k} x={140} y={20} w={88} h={110}><T x={151} y={39} s={9} c={INK} w={700}>Decision</T><Car k={k} x={160} y={50} c="#1b2229" s={1.35} /><rect x="151" y="91" width="66" height="4" rx="2" fill={SOFT} /><Tick k={k} x={166} y={114} r={9} /><T x={180} y={117.4} s={9} c="#1c8559" w={700}>Approved</T></Paper>
  </>),
  trip: (k) => (<>
    <Glass x={14} y={20} w={132} h={110} r={12} />
    {[[26, 32, 32, 24], [70, 32, 24, 32], [102, 38, 36, 22], [26, 68, 24, 44], [62, 76, 40, 36], [112, 74, 26, 38]].map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx="5" fill="#fff" opacity=".07" />)}
    <path d="M36 112 C60 66 92 108 126 44" stroke="#ffc20e" strokeWidth="3.4" fill="none" strokeDasharray="6 5" strokeLinecap="round" className="art-flow" />
    <circle cx="36" cy="112" r="8" fill={k.ember} /><T x={36} y={115.4} s={9} c="#fff" a="middle" w={700}>A</T><circle cx="126" cy="44" r="8" fill={k.mint} /><T x={126} y={47.4} s={9} c="#fff" a="middle" w={700}>B</T>
    <circle cx="190" cy="68" r="34" fill={k.paper} filter={k.shadow} /><path d="M165 83 a27 27 0 1 1 50 0" stroke="#cfd6db" strokeWidth="5" fill="none" strokeLinecap="round" /><path d="M165 83 a27 27 0 0 1 8 -20" stroke={k.mint} strokeWidth="5" fill="none" strokeLinecap="round" /><path d="M190 68 L205 52" stroke="#c2410c" strokeWidth="3.4" strokeLinecap="round" /><circle cx="190" cy="68" r="4" fill={INK} />
  </>),
  ai: (k) => (<>
    <Paper k={k} x={12} y={18} w={98} h={114}><T x={23} y={37} s={9} c="#c2410c" w={700}>Estimate</T>
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="23" y={47 + i * 14} width={i === 4 ? 42 : 76} height="7" rx="3.5" fill={i === 1 || i === 3 ? "#ffd04a" : SOFT} />)}
      <rect x="12" y="60" width="98" height="14" fill="#ffc20e" opacity=".16" className="art-scan" /></Paper>
    <Arrow x={115} y={75} w={22} />
    <Paper k={k} x={144} y={18} w={84} h={114}><T x={155} y={37} s={9} c={INK} w={700}>Draft form</T>{["Part", "Labour", "Total"].map((l, i) => <g key={l}><T x={155} y={52 + i * 22} s={7} c="#6d7a84">{l}</T><rect x="155" y={55 + i * 22} width="62" height="11" rx="3.5" fill="#eef1f3" /><rect x="158" y={58.6 + i * 22} width={26 + i * 10} height="4" rx="2" fill={INK} /></g>)}<rect x="155" y="114" width="62" height="14" rx="7" fill={k.mint} /><T x={186} y={124} s={7.6} c="#fff" a="middle">You check it</T></Paper>
    <path d="M226 10 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill={k.gold} />
  </>),
  chat: (k) => (<>
    <Glass x={12} y={12} w={130} h={126} r={14} />
    <rect x="22" y="24" width="92" height="38" rx="11" fill={k.paper} /><T x={31} y={39} s={8} c={INK}>Brake noise on</T><T x={31} y={51} s={8} c={INK}>LHR-1234</T>
    <rect x="40" y="72" width="94" height="46" rx="11" fill={k.mint} /><T x={49} y={88} s={8} c="#fff">Job card drafted.</T><T x={49} y={100} s={8} c="#fff">Confirm to send it?</T>
    <Arrow x={148} y={75} w={18} />
    <Paper k={k} x={170} y={38} w={62} h={76}><T x={178} y={54} s={8.4} c={INK} w={700}>JC-0142</T><Lines x={178} y={62} w={46} n={2} /><Btn k={k} x={178} y={86} w={46} h={14}>Request</Btn></Paper>
  </>),
  shield: (k) => (<>
    {[[14, 20, "A"], [88, 20, "B"], [162, 20, "C"]].map(([x, y, n], i) => (<g key={String(n)} transform={`translate(${x} ${y})`}><Glass x={0} y={0} w={64} h={52} r={10} stroke={i === 1 ? "#ffc20e" : LINE} /><rect x="10" y="11" width="44" height="5" rx="2.5" fill="#fff" opacity=".2" /><rect x="10" y="22" width="30" height="5" rx="2.5" fill="#fff" opacity=".2" /><rect x="10" y="33" width="38" height="5" rx="2.5" fill={i === 1 ? "#ffc20e" : "#fff"} opacity={i === 1 ? 0.9 : 0.2} /></g>))}
    <path d="M120 66 l34 12 v24 c0 17 -14 27 -34 33 c-20 -6 -34 -16 -34 -33 v-24 z" fill={k.gold} filter={k.shadow} /><path d="M120 66 l34 12 v24 c0 17 -14 27 -34 33 z" fill="#fff" opacity=".16" /><path d="M104 102 l12 12 l24 -26" stroke={INK} strokeWidth="5.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  workshop: (k) => (<>
    <Glass x={12} y={22} w={98} h={106} r={12} /><circle cx="60" cy="76" r="34" fill="#ffb300" opacity=".14" /><path d="M80 58 a16 16 0 0 0 -20 20 L34 104 l8 8 26 -26 a16 16 0 0 0 20 -20 l-10 10 -10 -2 -2 -10 z" fill={k.gold} filter={k.shadow} />
    <path d="M116 75 H144" stroke="#ffc20e" strokeWidth="2" strokeDasharray="3 3" className="art-flow" />
    <rect x="150" y="60" width="26" height="32" rx="6" fill={k.paper} filter={k.shadow} /><rect x="154" y="65" width="18" height="14" rx="3" fill={k.ember} />
    <Paper k={k} x={184} y={30} w={46} h={92}><T x={192} y={47} s={8} c="#c2410c" w={700}>Estimate</T><Lines x={192} y={55} w={30} n={3} /><rect x="192" y="86" width="30" height="12" rx="6" fill={INK} /><Tick k={k} x={207} y={110} r={6} /></Paper>
  </>),
  repeat: (k) => (<>
    <path d="M58 76 a46 46 0 1 1 28 42" stroke={k.ember} strokeWidth="7" fill="none" strokeLinecap="round" /><path d="M96 122 l-14 -2 l8 -12" stroke="#e8571a" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Car k={k} x={70} y={62} c={k.gold} s={1.5} />
    {[0, 1, 2].map((i) => <g key={i} transform={`translate(${158 + i * 26} 30)`}><circle cx="10" cy="10" r="10" fill="#fff" fillOpacity={i === 2 ? 0.14 : 0.06} stroke={i === 2 ? "#ffc20e" : LINE} /><T x={10} y={13.6} s={10} c={i === 2 ? "#ffc20e" : MUTE} a="middle" w={700}>{i + 1}</T></g>)}
    <g transform="translate(176 66)"><path d="M0 0 V34" stroke="#ffc20e" strokeWidth="2.6" strokeLinecap="round" /><path d="M0 1 H30 L23 9 L30 17 H0" fill={k.gold} /></g>
  </>),
  service: (k) => (<>
    <circle cx="74" cy="76" r="46" fill="#fff" fillOpacity=".05" stroke={LINE} strokeWidth="2" /><path d="M74 30 a46 46 0 1 1 -32 79" stroke={k.gold} strokeWidth="8" fill="none" strokeLinecap="round" />
    <path d="M74 76 V48 M74 76 L93 89" stroke="#fff" strokeWidth="3.8" strokeLinecap="round" /><circle cx="74" cy="76" r="5" fill={k.gold} />
    <Pill x={140} y={24} w={90} label="Overdue" c="#e8571a" /><Pill x={140} y={58} w={90} label="Due soon" c="#ffc20e" /><Pill x={140} y={92} w={90} label="Up to date" c="#3fc58a" />
  </>),
  fleet: (k) => (<>
    <rect x="0" y="104" width="240" height="46" fill="#0a0d10" opacity=".6" /><rect x="0" y="104" width="240" height="1.2" fill="#fff" opacity=".16" /><path d="M0 128 H240" stroke="#fff" strokeOpacity=".22" strokeWidth="2" strokeDasharray="12 9" className="art-flow" />
    <Car k={k} x={12} y={80} s={1.15} />
    <g transform="translate(66 74)"><rect width="44" height="27" rx="5" fill={k.gold} /><rect x="32" y="6" width="14" height="15" rx="2" fill={INK} opacity=".5" /><circle cx="10" cy="29" r="4.8" fill={INK} stroke="#fff" strokeWidth="1.4" /><circle cx="35" cy="29" r="4.8" fill={INK} stroke="#fff" strokeWidth="1.4" /></g>
    <g transform="translate(120 66)"><rect width="58" height="35" rx="5" fill={k.paper} /><rect x="58" y="12" width="21" height="23" rx="3.5" fill={k.ember} /><circle cx="12" cy="37" r="5.2" fill={INK} stroke="#fff" strokeWidth="1.4" /><circle cx="46" cy="37" r="5.2" fill={INK} stroke="#fff" strokeWidth="1.4" /><circle cx="68" cy="37" r="5.2" fill={INK} stroke="#fff" strokeWidth="1.4" /></g>
    <g transform="translate(202 72)"><rect width="28" height="23" rx="3.5" fill={k.mint} /><rect x="-10" y="9" width="12" height="3" fill="#ffc20e" /><circle cx="6" cy="27" r="4.8" fill={INK} stroke="#fff" strokeWidth="1.4" /><circle cx="22" cy="27" r="4.8" fill={INK} stroke="#fff" strokeWidth="1.4" /></g>
    {[[28, 58, "#3fc58a"], [88, 54, "#ffc20e"], [149, 46, "#e8571a"], [214, 52, "#3fc58a"]].map(([x, y, c], i) => <g key={i}><circle cx={Number(x)} cy={Number(y)} r="11" fill={String(c)} opacity=".2" /><circle cx={Number(x)} cy={Number(y)} r="5.6" fill={String(c)} /></g>)}
    <T x={120} y={30} s={11} c="#fff" a="middle" w={600}>Every vehicle, one record</T>
  </>),
  policy: (k) => (<>
    <Paper k={k} x={20} y={14} w={112} h={122}>
      <T x={32} y={34} s={10} c={INK} w={700}>Company policy</T><rect x="32" y="40" width="30" height="4" rx="2" fill={k.ember} />
      {[["Replacement due", "#e8571a"], ["Accident cover", "#f5a800"], ["Driver's share", "#1f8a5b"]].map(([l, c], i) => <g key={l}><rect x="32" y={54 + i * 24} width="88" height="19" rx="6" fill="#eef1f3" /><rect x="32" y={54 + i * 24} width="5" height="19" rx="2.5" fill={c} /><T x={44} y={67 + i * 24} s={7.8} c={INK}>{l}</T></g>)}
      <T x={32} y={128} s={6.8} c="#6b7882">Every version kept</T>
    </Paper>
    <Arrow x={138} y={75} w={22} />
    <g transform="translate(168 30)"><circle cx="30" cy="32" r="38" fill="#ffb300" opacity=".12" /><path d="M30 0 L58 10 V34 Q58 58 30 70 Q2 58 2 34 V10 Z" fill={k.gold} filter={k.shadow} /><path d="M17 34 l9 9 l18 -20" stroke={INK} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
    <T x={198} y={118} s={9} c="#fff" a="middle" w={600}>Applied for you</T>
  </>),
  cargo: (k) => (<>
    <rect x="0" y="112" width="240" height="38" fill="#0a0d10" opacity=".6" /><rect x="0" y="112" width="240" height="1.2" fill="#fff" opacity=".16" /><path d="M0 132 H240" stroke="#fff" strokeOpacity=".22" strokeWidth="2" strokeDasharray="12 9" className="art-flow" />
    <g transform="translate(34 56)"><rect width="84" height="48" rx="5" fill={k.paper} /><rect x="9" y="9" width="28" height="30" rx="3" fill={k.gold} /><rect x="42" y="18" width="26" height="21" rx="3" fill={k.ember} /><path d="M9 20 h28 M23 9 v30" stroke="#b07900" strokeWidth="1.6" /><rect x="84" y="14" width="34" height="34" rx="5" fill={k.mint} /><path d="M92 20 h18 v13 h-18 Z" fill={INK} opacity=".5" /><circle cx="22" cy="52" r="6.6" fill={INK} stroke="#fff" strokeWidth="1.6" /><circle cx="96" cy="52" r="6.6" fill={INK} stroke="#fff" strokeWidth="1.6" /></g>
    <g transform="translate(166 22)"><Glass x={0} y={0} w={64} h={52} r={12} stroke="#ffc20e" /><T x={32} y={20} s={8} c="#fff" a="middle" w={600}>Pick-up</T><circle cx="32" cy="34" r="6" fill={k.ember} /><path d="M32 40 l-5 7 h10 Z" fill={k.ember} /></g>
    <g transform="translate(172 84)"><Glass x={0} y={0} w={58} h={20} r={10} stroke="#3fc58a" /><Tick k={k} x={12} y={10} r={5} /><T x={22} y={13.4} s={8} c="#fff">Delivered</T></g>
  </>),
  menu: (k) => (<>
    <g transform="translate(78 8)"><rect width="84" height="134" rx="14" fill="#0b0f13" stroke="#fff" strokeOpacity=".3" strokeWidth="2" /><rect x="6" y="6" width="72" height="122" rx="9" fill="#1d252c" /><rect x="6" y="6" width="72" height="18" rx="9" fill="#1f8a5b" /><circle cx="17" cy="15" r="5" fill="#fff" /><T x={27} y={18} s={7.6} c="#fff" w={700}>Fleet OTG</T>
      <rect x="12" y="30" width="42" height="14" rx="7" fill="#2b353d" /><T x={19} y={40} s={7.2} c="#fff">Hi</T>
      {["Job card", "Cargo", "Trip", "Odometer"].map((l, i) => <g key={l}><rect x="12" y={52 + i * 17} width="60" height="13" rx="6.5" fill={i === 0 ? k.gold : "#33404a"} /><T x={42} y={61.6 + i * 17} s={7.4} c={i === 0 ? INK : "#fff"} a="middle" w={600}>{l}</T></g>)}
      <rect x="30" y="122" width="40" height="3" rx="1.5" fill="#fff" opacity=".35" /></g>
    <Pill x={8} y={34} w={62} label="Job card" c="#ffc20e" /><Pill x={170} y={34} w={62} label="Cargo" c="#e8571a" /><Pill x={8} y={96} w={62} label="Trip" c="#3fc58a" /><Pill x={170} y={96} w={62} label="Reading" c="#ffc20e" />
  </>),
  tender: (k) => (<>
    {[["Provider A", 18, 0], ["Provider B", 56, 1], ["Provider C", 94, 0]].map(([l, y, win]) => <g key={String(l)}><rect x="20" y={Number(y)} width="124" height="30" rx="9" fill={win ? k.paper : "#fff"} fillOpacity={win ? 1 : 0.08} stroke={win ? "#ffc20e" : LINE} strokeWidth={win ? 2.2 : 1} filter={win ? k.shadow : undefined} /><circle cx="37" cy={Number(y) + 15} r="8" fill={win ? k.gold : "#33404a"} /><T x={52} y={Number(y) + 18} s={8.4} c={win ? INK : "#c9d3d9"} w={600}>{String(l)}</T><rect x="104" y={Number(y) + 11} width="30" height="8" rx="4" fill={win ? k.ember : "#4a5864"} /></g>)}
    <Arrow x={150} y={73} w={18} />
    <g transform="translate(176 40)"><circle cx="28" cy="34" r="36" fill="#ffb300" opacity=".14" /><path d="M28 0 l8 18 l20 2 l-15 13 l5 20 l-18 -11 l-18 11 l5 -20 l-15 -13 l20 -2 Z" transform="translate(0 6)" fill={k.gold} filter={k.shadow} /></g>
    <T x={204} y={118} s={9} c="#fff" a="middle" w={600}>You award one</T>
  </>),
  price: (k) => (<>
    <g transform="translate(70 24)"><circle cx="50" cy="52" r="56" fill="#ffb300" opacity=".14" /><rect x="8" y="22" width="84" height="60" rx="14" fill={k.gold} filter={k.shadow} /><circle cx="22" cy="52" r="5" fill={INK} opacity=".4" /><T x={58} y={50} s={11} c={INK} a="middle" w={700}>One price</T><T x={58} y={65} s={7.6} c="#6b4a00" a="middle" w={600}>whole company</T></g>
    {[[28, 40], [48, 100], [200, 38], [188, 104], [118, 124]].map(([x, y], i) => <Person key={i} k={k} x={x} y={y} ember={i % 2 === 1} />)}
    {[[34, 52, 70, 64], [54, 94, 80, 82], [194, 50, 168, 62], [184, 98, 160, 86]].map(([a, b, c, d], i) => <path key={i} d={`M${a} ${b} L${c} ${d}`} stroke="#ffc20e" strokeWidth="1.6" strokeDasharray="3 4" opacity=".6" className="art-flow" />)}
  </>),
  plans: (k) => (<>
    <g transform="translate(12 20)"><Glass x={0} y={0} w={102} h={112} r={13} /><T x={13} y={24} s={11} c="#fff" w={700}>Basic</T>{["Job cards", "Workshops", "Reminders", "Budgets"].map((l, i) => <g key={l}><Tick k={k} x={21} y={44 + i * 16} r={5} /><T x={31} y={47 + i * 16} s={8} c="#c9d3d9">{l}</T></g>)}</g>
    <g transform="translate(124 10)"><rect width="104" height="130" rx="13" fill={k.paper} filter={k.shadow} /><rect width="104" height="130" rx="13" fill="none" stroke="#e8571a" strokeWidth="2" /><T x={13} y={25} s={11} c={INK} w={700}>Pro</T><rect x="62" y="10" width="30" height="18" rx="9" fill={k.gold} /><T x={77} y={22.6} s={8.6} c={INK} a="middle" w={700}>AI</T>{["All of Basic", "AI reading", "WhatsApp job cards"].map((l, i) => <g key={l}><Tick k={k} x={21} y={47 + i * 19} r={5} /><T x={31} y={50 + i * 19} s={7} c={INK}>{l}</T></g>)}<Btn k={k} x={13} y={104} w={78} h={17}>Try free for 7 days</Btn></g>
  </>),
  mail: (k) => (<>
    <rect x="24" y="42" width="116" height="80" rx="12" fill={k.paper} filter={k.shadow} /><path d="M24 52 l58 38 l58 -38" stroke="#9aa6af" strokeWidth="3" fill="none" strokeLinejoin="round" />
    <rect x="122" y="18" width="108" height="50" rx="14" fill={k.ember} filter={k.shadow} /><path d="M150 68 l-7 15 l17 -15" fill="#b53a08" /><T x={176} y={41} s={10} c="#fff" a="middle" w={700}>Question?</T><T x={176} y={55} s={7.6} c="#ffe0d0" a="middle">We read every message</T>
    <Glass x={160} y={86} w={54} h={48} r={12} stroke="#ffc20e"><circle cx="187" cy="105" r="6" fill="none" stroke="#ffc20e" strokeWidth="2.8" /><path d="M175 124 q0 -11 12 -11 q12 0 12 11" stroke="#ffc20e" strokeWidth="2.8" fill="none" strokeLinecap="round" /></Glass>
  </>),
  sheets: (k) => (<>
    <rect x="10" y="22" width="100" height="106" rx="9" fill={k.paper} filter={k.shadow} />{Array.from({ length: 6 }, (_, r) => Array.from({ length: 4 }, (_, c) => <rect key={`${r}${c}`} x={17 + c * 22.4} y={29 + r * 15.6} width="19.4" height="11.6" rx="2.4" fill={r === 2 && c === 1 ? "#f6c3b0" : r === 4 && c === 3 ? "#fbe39a" : "#e8ecef"} />))}<path d="M20 102 l62 -42 M30 68 l52 32" stroke="#c2410c" strokeWidth="2.4" opacity=".85" strokeLinecap="round" />
    <Arrow x={116} y={75} w={20} />
    <Paper k={k} x={144} y={22} w={86} h={106}><T x={155} y={41} s={9.4} c={INK} w={700}>Job card</T><rect x="155" y="49" width="64" height="10" rx="5" fill={k.ember} /><Lines x={155} y={67} w={64} n={3} /><Tick k={k} x={169} y={107} r={8} /><T x={183} y={110} s={7.6} c="#1c8559" w={700}>One record</T></Paper>
  </>),
};

export type ArtName = keyof typeof SCENES;
export const ART_NAMES = Object.keys(SCENES);

/** One illustration, scaled to the box it is put in (8 wide by 5 high). */
export function Art({ name, className = "" }: { name: ArtName | string; className?: string }) {
  const id = useId();
  const scene = SCENES[name];
  if (!scene) return null;
  const u = `a${id.replace(/[^a-zA-Z0-9]/g, "")}-`;
  return (
    <div className={`art aspect-[8/5] w-full overflow-hidden rounded-2xl bg-[#10151a] shadow-[0_16px_36px_-22px_rgb(0_0_0/0.6)] ring-1 ring-black/10 ${className}`}>
      <Frame u={u}>{scene(kit(u))}</Frame>
    </div>
  );
}
