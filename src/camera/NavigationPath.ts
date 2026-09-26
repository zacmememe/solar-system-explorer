import * as THREE from 'three';
export interface NavigationBody {
    id: string;
    position: THREE.Vector3;
    radius: number;
    focusPosition?: THREE.Vector3;
}
export interface NavigationScene {
    sample: (secondsAhead: number) => NavigationBody[];
    /** Sampling density includes the fastest orbit at the current user time scale. */
    samples: number;
    revision: string;
}
export const flightEase = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** Short great-circle offset with continuous radial height, including polar/seam crossings. */
export function surfaceArcOffset(from: THREE.Vector3, to: THREE.Vector3, progress: number): THREE.Vector3 {
    const a = from.clone().normalize(), b = to.clone().normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(a, b);
    a.applyQuaternion(new THREE.Quaternion().slerp(rotation, progress));
    return a.multiplyScalar(THREE.MathUtils.lerp(from.length(), to.length(), progress));
}
/** Zero value, velocity and acceleration at both ends. */
export const flightArch = (t: number, skew = 1) => {
    const u = t / (t + skew * (1 - t));
    return 64 * u * u * u * (1 - u) * (1 - u) * (1 - u);
};
export interface FlightDetour {
    offset: THREE.Vector3;
    skew: number;
}
/** Relative-motion line sweep with a linearly changing radius. */
export function sweepClear(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number): boolean {
    const d = b.clone().sub(a), dr = r1 - r0;
    const A = d.lengthSq() - dr * dr, B = 2 * (a.dot(d) - r0 * dr);
    // Evaluate in local coordinates: huge endpoints must not hide a tiny moon.
    const outside = (t: number) => {
        const distanceSq = a.clone().addScaledVector(d, t).lengthSq(), radiusSq = (r0 + dr * t) ** 2;
        return distanceSq - radiusSq >= -Number.EPSILON * Math.max(distanceSq, radiusSq) * 8;
    };
    return outside(0) && outside(1) && (A <= 0 || outside(THREE.MathUtils.clamp(-B / (2 * A), 0, 1)));
}
/** Plan a C2 detour against the SAME moving/scaling bodies that are displayed.
 * No geometry is hidden or rescaled to make a path pass. The chosen arch is
 * frozen for this flight; later time-control changes require a new plan.
 */
export function planFlightArch(scene: NavigationScene, duration: number, raw: (t: number, bodies: NavigationBody[]) => THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): FlightDetour | null {
    const n = Math.max(128, Math.min(4096, Math.ceil(scene.samples * Math.max(1, duration / 2.5))));
    const frame = (t: number) => {
        const bodies = scene.sample(t * duration);
        return { t, bodies, p: raw(t, bodies), w: flightArch(t) };
    };
    const frames = Array.from({ length: n + 1 }, (_, i) => frame(i / n));
    const midpoints = Array.from({ length: n }, (_, i) => frame((i + .5) / n));
    const startBodies = frames[0].bodies;
    const allowance = startBodies.map(b => Math.max(0, b.radius - start.distanceTo(b.position) + b.radius * 1e-6));
    const radius = (body: NavigationBody, t: number, j: number) => Math.max(0, body.radius * (1 + 0.08 * flightArch(t)) - allowance[j] * (1 - flightEase(Math.min(1, t / .08))));
    type Frame = ReturnType<typeof frame>;
    // Cache only subdivisions actually needed near a surface or a moving moon.
    const cache = new Map<number, Frame>();
    const at = (t: number) => { let f = cache.get(t); if (!f) {
        f = frame(t);
        cache.set(t, f);
    } return f; };
    const segmentClear = (a: Frame, b: Frame, m: Frame, detour: FlightDetour, depth = 0): boolean => {
        const ca = a.p.clone().addScaledVector(detour.offset, flightArch(a.t, detour.skew)), cb = b.p.clone().addScaledVector(detour.offset, flightArch(b.t, detour.skew));
        const cm = m.p.clone().addScaledVector(detour.offset, flightArch(m.t, detour.skew));
        const pathError = 2 * cm.distanceTo(ca.clone().lerp(cb, .5));
        let needsSplit = false;
        for (let j = 0; j < b.bodies.length; j++) {
            const p = a.bodies[j], q = b.bodies[j], mid = m.bodies[j];
            const r0 = radius(p, a.t, j), r1 = radius(q, b.t, j), rm = radius(mid, m.t, j);
            const ra = ca.clone().sub(p.position), rb = cb.clone().sub(q.position), rc = cm.clone().sub(mid.position);
            // Endpoint/midpoint intersection is definitive; curvature inflation alone
            // is not. Subdivide near a surface instead of rejecting a safe departure.
            if (!sweepClear(ra, ra, r0, r0) || !sweepClear(rb, rb, r1, r1) || !sweepClear(rc, rc, rm, rm))
                return false;
            const error = pathError + 2 * mid.position.distanceTo(p.position.clone().lerp(q.position, .5)) + 2 * Math.abs(rm - (r0 + r1) / 2);
            if (!sweepClear(ra, rb, r0 + error, r1 + error))
                needsSplit = true;
        }
        if (!needsSplit)
            return true;
        if (depth >= 12)
            return false;
        return segmentClear(a, m, at((a.t + m.t) / 2), detour, depth + 1) && segmentClear(m, b, at((m.t + b.t) / 2), detour, depth + 1);
    };
    if (frames[n].bodies.some(b => end.distanceTo(b.position) < b.radius))
        return null;
    const clear = (detour: FlightDetour) => {
        for (let i = 1; i <= n; i++)
            if (!segmentClear(frames[i - 1], frames[i], midpoints[i - 1], detour))
                return false;
        return true;
    };
    const zero = { offset: new THREE.Vector3(), skew: 1 };
    if (clear(zero))
        return zero;
    const line = end.clone().sub(start).normalize();
    const directions = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
        new THREE.Vector3().crossVectors(line, new THREE.Vector3(0, 1, 0)).normalize()];
    const nearest = [...startBodies].sort((a, b) => start.distanceTo(a.position) - a.radius - (start.distanceTo(b.position) - b.radius))[0];
    if (nearest)
        directions.unshift(start.clone().sub(nearest.position).normalize());
    const initial = Math.max(0.001, start.distanceTo(end) * .025);
    for (let amplitude = initial; amplitude <= Math.max(1000, start.distanceTo(end) * 8); amplitude *= 1.65) {
        for (const direction of directions) {
            if (direction.lengthSq() < .5)
                continue;
            for (const skew of [1, .1, 10, .01, 100]) {
                const detour = { offset: direction.clone().multiplyScalar(amplitude), skew };
                if (clear(detour))
                    return detour;
            }
        }
    }
    return null;
}
/** Keep the selected satellite as foreground, with its true parent behind it.
 * Offset in the wider viewport axis; never enlarge/reposition either body.
 */
export function satelliteViewDirection(satellite: THREE.Vector3, parent: THREE.Vector3, parentRadius: number, fovDegrees: number, aspect: number, sunDirection: THREE.Vector3): THREE.Vector3 {
    const away = satellite.clone().sub(parent).normalize();
    const vertical = THREE.MathUtils.degToRad(fovDegrees) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * aspect);
    const parentAngle = Math.asin(Math.min(.99, parentRadius / satellite.distanceTo(parent)));
    // Portrait has navigation above and instruments below. Keep the parent
    // above the satellite within that clear area; a nearby giant parent may
    // extend beyond the viewport, but its lower limb should remain visible.
    const angle = aspect < 1 ? Math.atan(Math.tan(vertical) * .5)
        : Math.max(.035, Math.min(.35, horizontal - parentAngle - .07));
    let side = aspect >= 1 ? new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), away)
        : new THREE.Vector3(0, 1, 0).addScaledVector(away, -away.y);
    if (side.lengthSq() < 1e-8)
        side = new THREE.Vector3(1, 0, 0).addScaledVector(away, -away.x);
    side.normalize();
    if (aspect >= 1 && side.dot(sunDirection) < 0)
        side.negate();
    return away.multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).normalize();
}
