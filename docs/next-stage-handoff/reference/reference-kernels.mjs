/** Small, renderer-independent design kernels. Not a replacement CameraController.
 * All distances passed to a single operation must share the SAME unit/reference frame.
 */
const finite = (n, name) => { if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`); return n; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function normalizeWheelDelta(deltaY, deltaMode, viewportHeightPx, lineHeightPx = 16) {
  finite(deltaY,'deltaY'); finite(viewportHeightPx,'viewportHeightPx'); finite(lineHeightPx,'lineHeightPx');
  if (viewportHeightPx <= 0 || lineHeightPx <= 0) throw new RangeError('Positive dimensions required');
  if (![0, 1, 2].includes(deltaMode)) throw new RangeError('Unknown WheelEvent.deltaMode');
  return deltaY * [1, lineHeightPx, viewportHeightPx][deltaMode];
}

export function pinchLogDelta(previousSpanPx, currentSpanPx) {
  if (!(previousSpanPx > 0 && currentSpanPx > 0)) throw new RangeError('Positive spans required');
  finite(previousSpanPx,'previousSpanPx'); finite(currentSpanPx,'currentSpanPx');
  return Math.log(previousSpanPx / currentSpanPx);
}

/** Shifted-log dolly state. Use surface CLEARANCE for a body anchor, pivot distance for free space.
 * CameraController must first resolve cancellation/bounds/anchors; do not feed incompatible limits.
 */
export class LogDollyKernel {
  constructor(initial, { min = 1.7, max = 1e10, shift = 1, tauSec = 0.09 } = {}) {
    for (const [k,v] of Object.entries({initial,min,max,shift,tauSec})) finite(v,k);
    if (!(0 <= min && min < max && shift > 0 && tauSec > 0 && initial >= min && initial <= max)) throw new RangeError('Invalid dolly range');
    this.min = min; this.max = max; this.shift = shift; this.tauSec = tauSec;
    this.logActual = Math.log(initial + shift); this.logTarget = this.logActual; this.lastInputSign = 0;
  }
  get actual() { return Math.exp(this.logActual) - this.shift; }
  get target() { return Math.exp(this.logTarget) - this.shift; }
  inputLog(delta) {
    finite(delta,'delta'); if (delta === 0) return;
    const sign = Math.sign(delta);
    // Reverse input must not first finish the previous direction's pending travel.
    if (this.lastInputSign !== 0 && sign !== this.lastInputSign) this.logTarget = this.logActual;
    this.lastInputSign = sign;
    this.logTarget = clamp(this.logTarget + delta, Math.log(this.min + this.shift), Math.log(this.max + this.shift));
  }
  update(dtSec) {
    finite(dtSec,'dtSec'); if (dtSec < 0) throw new RangeError('dtSec must not be negative');
    this.logActual += (this.logTarget - this.logActual) * (-Math.expm1(-dtSec / this.tauSec));
    return this.actual;
  }
  stop() { this.logTarget = this.logActual; this.lastInputSign = 0; }
}

function grid(level) {
  if (!Number.isInteger(level) || level < 0 || level > 24) throw new RangeError('level must be 0..24');
  return {nx:2**(level+1), ny:2**level};
}
/** Geographic two-root-tile pyramid, NOT Web Mercator. East-positive lon, north-positive lat.
 * Tile y runs north-to-south. Does not imply that Three.js texture v runs in that direction.
 */
export function geographicTile(longitudeDeg, latitudeDeg, level) {
  finite(longitudeDeg,'longitudeDeg'); finite(latitudeDeg,'latitudeDeg');
  if (latitudeDeg < -90 || latitudeDeg > 90) throw new RangeError('Latitude outside globe');
  const {nx,ny}=grid(level);
  const longitudeWrapped=((longitudeDeg+180)%360+360)%360-180;
  return {level, x:Math.min(nx-1,Math.floor((longitudeWrapped+180)/360*nx)), y:Math.min(ny-1,Math.floor((90-latitudeDeg)/180*ny))};
}
export function tileBounds({level,x,y}) {
  const {nx,ny}=grid(level);
  if (!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=nx||y<0||y>=ny) throw new RangeError('Invalid tile');
  return {westDeg:x/nx*360-180,eastDeg:(x+1)/nx*360-180,northDeg:90-y/ny*180,southDeg:90-(y+1)/ny*180};
}
/** Parent sampling coordinates in canonical north-down UV, prior to GPU flip/georeferencing. */
export function childUvInParent(tile, u, v) {
  tileBounds(tile); if(tile.level===0)throw new RangeError('Root has no parent');
  if(!(u>=0&&u<=1&&v>=0&&v<=1))throw new RangeError('UV outside child');
  return {u:(tile.x%2+u)*.5,v:(tile.y%2+v)*.5};
}

/** Only for the UNSIGNED HALF-METRE TIFFs documented by NASA SVS CGI Moon Kit (4720).
 * Do NOT use for float-km TIFF, signed PDS products, or a DTM that stores absolute radius.
 * Output: elevation metres relative to the 1,737,400 m reference sphere.
 */
export function decodeMoonKitUnsignedHeight(value) {
  if (!Number.isInteger(value)||value<0||value>65535)throw new RangeError('uint16 required');
  return value * .5 - 10000;
}
export function relativeBeforeFloat(position, origin) {
  if(position.length!==3||origin.length!==3)throw new RangeError('Three coordinates required');
  return position.map((v,i)=>Math.fround(finite(v,'position')-finite(origin[i],'origin')));
}
