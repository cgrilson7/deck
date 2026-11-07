import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Ps2Button } from "@shared/types";
import { useMarathon } from "../lib/marathon";
import { Fox } from "./Fox";
import { usePad, type PadState } from "../lib/ps2pad";
import ds2Photo from "../assets/ds2.webp";

/** The stage's own size: what the screen recorder films (1080×1920, Reels / Stories). */
export const FP_W = 1080;
export const FP_H = 1920;

/**
 * THE RUSHING ATTACK MARATHON, as a 9:16 piece made to be filmed: the game's picture (PCSX2 mirrored into
 * `canvasRef`), under it the marathon board — the title, the race clock, yards rushed, touchdowns, miles, and
 * Foxtrot running along a progress bar to 26.2 (main/marathon.ts counts Colin's plays off Madden's RAM) —
 * and a DualShock 2 whose buttons light orange as they are pressed (the real controller through the Gamepad
 * API, and the deck's own keys). Laid out at 1080×1920 and scaled to fit its box, so the tile and the pane
 * show the same frame, and the pane's record button lays the recorder exactly over it.
 */
export function FoxtrotPlays({
  game,
  canvasRef,
  live,
  empty,
  onPress,
  stageRef,
}: {
  game: string | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  live: boolean;
  /** What the screen says while there is no picture. */
  empty: ReactNode;
  /** The drawn pad plays too (the pane): a button down / up. */
  onPress?: (b: Ps2Button, down: boolean) => void;
  stageRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  const pad = usePad();

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () =>
      setK(Math.min(el.clientWidth / FP_W, el.clientHeight / FP_H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="fp-box">
      <div
        ref={stageRef}
        className="fp"
        style={{
          transform: `translate(-50%, -50%) scale(${k})`,
          visibility: k ? undefined : "hidden",
        }}
      >
        <div className="fp-top">
          <i className={`ps2-lamp green ${game ? "on" : ""}`} />
          <i className={`ps2-lamp blue ${live ? "on" : ""}`} />
        </div>
        <div className="fp-screen">
          <canvas
            ref={canvasRef}
            className="ps2-canvas"
            style={{ display: live ? undefined : "none" }}
          />
          {!live && <div className="fp-empty">{empty}</div>}
        </div>
        <MarathonBoard />
        <div className="fp-pad">
          <DualShock2 pad={pad} onPress={onPress} />
        </div>
      </div>
    </div>
  );
}

const MILE = 1760;

/** h:mm:ss, the race clock's way. */
function clock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(t / 3600)}:${two(Math.floor(t / 60) % 60)}:${two(t % 60)}`;
}

/** The title, the four numbers, and Foxtrot running along the bar to 26.2 miles. */
function MarathonBoard() {
  const m = useMarathon();
  const now = useClockTick(m?.inGame ?? false);
  const yards = m?.yards ?? 0;
  const goal = m?.goal ?? 46_112;
  const miles = yards / MILE;
  const share = Math.max(0, Math.min(1, yards / goal));
  const ms = m
    ? m.activeMs + (m.inGame ? Math.max(0, now - m.receivedAt) : 0)
    : 0;
  const last = m?.last && Date.now() - m.last.at < 6000 ? m.last : null;
  return (
    <div className="fp-board">
      <div className="fp-title">RUSHING ATTACK MARATHON</div>
      <div className="fp-stats">
        <Stat label="TIME" value={clock(ms)} />
        <Stat label="YARDS" value={Math.round(yards).toLocaleString("en-US")} />
        <Stat label="TDs" value={String(m?.tds ?? 0)} />
        <Stat label="MILES" value={miles.toFixed(2)} />
      </div>
      <div className="fp-track">
        <div className="fp-lane">
          <div className="fp-bar">
            <i style={{ width: `${share * 100}%` }} />
          </div>
          <div className="fp-runner" style={{ left: `${share * 100}%` }}>
            <Fox anim={m?.live ? "run" : "idle"} scale={4} />
            {last && (
              <span key={last.at} className={`fp-gain${last.td ? " td" : ""}`}>
                {last.td ? "TD! " : ""}
                {last.yards >= 0 ? "+" : ""}
                {last.yards.toFixed(1)} YD
              </span>
            )}
          </div>
        </div>
        <div className="fp-ends">
          <span>0</span>
          <span>26.2 MI</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="fp-stat">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

/** A re-render every 250 ms while the race clock runs (the stopwatch between main's pushes). */
function useClockTick(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [running]);
  return running ? now : Date.now();
}

// ---- the DualShock 2 ----------------------------------------------------------------------------------
// THE REAL CONTROLLER: Evan-Amos's photo of a DualShock 2 (Wikimedia Commons, public domain; assets/
// CREDITS-ds2.md), cut out on transparency, with a hotspot laid over every button it shows — in the
// photo's own pixels (1520×1220), placed by rendering them over it — that lights Foxtrot's orange while the
// button is down (a screen blend, so the button's own face and symbol show through, lit, plus a glow).
// The photo is a ¾ view and its shoulders hide behind the body, so L1 / L2 and R1 / R2 are tabs over its
// back edge (the cable is taken out of the photo: the DualSense is wireless, and it ran through R1 / R2's
// place). A stick that leans shows as an orange ring pushed the way it leans; L3 / R3 light its cap.

const PHOTO_W = 1520;
const PHOTO_H = 1220;
/** Room above the photo for the shoulder tabs. */
const TOP = 120;

type Spot = [Ps2Button, number, number, number, number, number?];
/** button, cx, cy, rx, ry, rotation° — in the photo's pixels. */
const SPOTS: Spot[] = [
  ["left", 380, 225, 46, 36, -30],
  ["up", 494, 182, 46, 36, 20],
  ["right", 529, 266, 46, 36, -30],
  ["down", 418, 301, 46, 36, 20],
  ["triangle", 1262, 372, 52, 44],
  ["square", 1114, 413, 52, 44],
  ["circle", 1319, 483, 52, 44],
  ["cross", 1167, 532, 52, 44],
  ["select", 714, 331, 32, 18, 15],
  ["start", 945, 398, 32, 18, 15],
];
const STICKS = {
  l: { cx: 502, cy: 388, rx: 72, ry: 62, press: "l3" as Ps2Button },
  r: { cx: 897, cy: 517, rx: 76, ry: 66, press: "r3" as Ps2Button },
};
/** The shoulder tabs: button, label, x, y (centre), rotation° — over the photo's back edge, front tab lower. */
const SHOULDERS: [Ps2Button, string, number, number, number][] = [
  ["l2", "L2", 600, -14, -4],
  ["l1", "L1", 600, 50, -4],
  ["r2", "R2", 1325, 172, 8],
  ["r1", "R1", 1325, 238, 8],
];

function DualShock2({
  pad,
  onPress,
}: {
  pad: PadState;
  onPress?: (b: Ps2Button, down: boolean) => void;
}) {
  const on = (b: Ps2Button) => pad.down.has(b);
  const hold = (b: Ps2Button) =>
    onPress
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            onPress(b, true);
          },
          onPointerUp: () => onPress(b, false),
          onPointerCancel: () => onPress(b, false),
          style: { cursor: "pointer" },
        }
      : {};

  return (
    <svg
      className={`ds2${onPress ? " playable" : ""}`}
      viewBox={`0 ${-TOP} ${PHOTO_W} ${PHOTO_H + TOP}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="DualShock 2"
    >
      <defs>
        <filter id="ds2-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      {/* Shoulders first: they sit behind the body's back edge. */}
      {SHOULDERS.map(([b, label, x, y, rot]) => (
        <g
          key={b}
          className={`ds2-sh${on(b) ? " on" : ""}`}
          transform={`translate(${x} ${y}) rotate(${rot})`}
          {...hold(b)}
        >
          <rect x="-110" y="-30" width="220" height="60" rx="26" />
          <text y="-9">{label}</text>
        </g>
      ))}

      <image href={ds2Photo} x="0" y="0" width={PHOTO_W} height={PHOTO_H} />

      {SPOTS.map(([b, cx, cy, rx, ry, rot = 0]) => (
        <g
          key={b}
          className={`ds2-spot${on(b) ? " on" : ""}`}
          transform={`rotate(${rot} ${cx} ${cy})`}
          {...hold(b)}
        >
          <ellipse
            className="ds2-glow"
            cx={cx}
            cy={cy}
            rx={rx * 1.5}
            ry={ry * 1.5}
            filter="url(#ds2-glow)"
          />
          <ellipse className="ds2-lit" cx={cx} cy={cy} rx={rx} ry={ry} />
        </g>
      ))}

      {(["l", "r"] as const).map((k) => {
        const st = STICKS[k];
        const x = k === "l" ? pad.lx : pad.rx;
        const y = k === "l" ? pad.ly : pad.ry;
        const moved = Math.hypot(x, y) > 0.25;
        const pressed = on(st.press);
        const dx = x * st.rx * 0.45;
        const dy = y * st.ry * 0.45;
        return (
          <g
            key={k}
            className={`ds2-spot ds2-stick${pressed ? " on" : ""}${moved ? " moved" : ""}`}
            {...hold(st.press)}
          >
            <ellipse
              className="ds2-glow"
              cx={st.cx + dx}
              cy={st.cy + dy}
              rx={st.rx * 1.3}
              ry={st.ry * 1.3}
              filter="url(#ds2-glow)"
            />
            <ellipse
              className="ds2-lit"
              cx={st.cx}
              cy={st.cy}
              rx={st.rx}
              ry={st.ry}
            />
            <ellipse
              className="ds2-ring"
              cx={st.cx + dx}
              cy={st.cy + dy}
              rx={st.rx + 8}
              ry={st.ry + 8}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** The stage's rectangle in the window, for the recorder (its CSS-px box as drawn, i.e. scaled). */
export function stageRect(
  el: HTMLElement | null,
): { x: number; y: number; width: number; height: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0
    ? { x: r.left, y: r.top, width: r.width, height: r.height }
    : null;
}
