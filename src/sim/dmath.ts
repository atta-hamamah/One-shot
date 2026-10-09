// Deterministic math for the simulation.
//
// The game promises that a shot (angle + power) produces the exact same result
// on every device: the daily room is fair, replays are tiny, and the server can
// re-simulate a submitted shot to verify it. JS arithmetic (+ - * /) and
// Math.sqrt are IEEE-754 correctly rounded on every engine, but Math.sin,
// Math.cos, Math.atan2, Math.hypot, Math.pow, ... are "implementation
// approximated" and may differ between browsers. So the simulation only uses
// the basic operators, Math.sqrt, and the functions in this file.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Deterministic sine (max error ~1e-15 on any input). */
export function dsin(x: number): number {
  // Reduce to [-PI, PI]. Math.round is exact, so this is deterministic.
  x = x - TAU * Math.round(x / TAU);
  // Reduce to [-PI/2, PI/2] using sin(PI - x) = sin(x).
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  // Taylor series, Horner form, up to x^19.
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 *
                        (-1 / 39916800 +
                          x2 *
                            (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 * (1 / 355687428096000 + x2 * (-1 / 121645100408832000))))))))))
  );
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** Converts a shot angle (tenths of a degree, 0 = right, 900 = straight up) to a unit vector in screen space (y down). */
export function angleToDir(angleTenths: number): { x: number; y: number } {
  const rad = (angleTenths / 1800) * PI;
  return { x: dcos(rad), y: -dsin(rad) };
}
