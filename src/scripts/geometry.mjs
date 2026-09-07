/**
 * Token-to-token range tests. DESIGN.md §6.9
 *
 * Aura Share called canvas.grid.measurePath() once per candidate pair — the full grid-path
 * measurement API for what is a rectangle-gap test. Here the common diagonal rules are
 * computed directly in a handful of integer operations; the exotic ones fall back to
 * measurePath, which is correct and rare enough not to matter.
 *
 * Rects are cached per token document and rebuilt only when that token moves.
 */

const rects = new Map(); // tokenId -> {x0, x1, y0, y1, px, elevation}

/**
 * A token's footprint, in whole grid squares AND in pixels.
 *
 * Both, because the two supported grids need different precision: a square grid snaps to
 * whole squares, while gridless is euclidean and would lose the sub-square placement that
 * is the entire point of having no grid.
 */
function buildRect(doc) {
  const gs = canvas.dimensions.size;
  // The document is already at its destination when movement starts; only the sprite lags.
  const dest = doc.movement?.destination ?? doc;
  const w = dest.width ?? doc.width ?? 1;
  const h = dest.height ?? doc.height ?? 1;

  const x0 = Math.round(dest.x / gs);
  const y0 = Math.round(dest.y / gs);
  // A sub-square token still occupies one square.
  const cols = Math.max(1, Math.ceil(w));
  const rows = Math.max(1, Math.ceil(h));

  return {
    x0,
    x1: x0 + cols - 1,
    y0,
    y1: y0 + rows - 1,
    px: { left: dest.x, right: dest.x + w * gs, top: dest.y, bottom: dest.y + h * gs },
    elevation: dest.elevation ?? 0,
  };
}

export function rectFor(doc) {
  let r = rects.get(doc.id);
  if (!r) rects.set(doc.id, (r = buildRect(doc)));
  return r;
}

/** Drop a token's cached rect. */
export function invalidate(tokenId) {
  if (tokenId) rects.delete(tokenId);
  else rects.clear();
}

/** Gap between two spans, in squares. Zero when they touch or overlap. */
const gap = (a0, a1, b0, b1) => Math.max(0, a0 - b1, b0 - a1);

/**
 * Distance in scene units between two token documents.
 *
 * Three paths, by grid type:
 *   square   — integer rectangle gap, then the scene's diagonal rule. The hot path.
 *   gridless — euclidean edge-to-edge, in pixels converted to scene units.
 *   hex      — deferred to canvas.grid.measurePath, which already knows the geometry.
 *
 * The diagonal rule is the scene's, not a module setting — a range that disagrees with the
 * ruler is worse than one that is slightly wrong.
 */
export function distance(aDoc, bDoc, { ignoreElevation = false } = {}) {
  const grid = canvas.grid;
  const gd = canvas.dimensions.distance;

  const a = rectFor(aDoc);
  const b = rectFor(bDoc);

  const dzUnits = ignoreElevation ? 0 : Math.abs(a.elevation - b.elevation);

  if (grid.type === CONST.GRID_TYPES.GRIDLESS) return gridlessDistance(a, b, dzUnits);
  if (grid.type !== CONST.GRID_TYPES.SQUARE) return hexDistance(a, b, dzUnits, ignoreElevation);

  const dx = gap(a.x0, a.x1, b.x0, b.x1);
  const dy = gap(a.y0, a.y1, b.y0, b.y1);
  const dz = dzUnits / gd;

  if (!dx && !dy && !dz) return 0;

  switch (grid.diagonals) {
    // 5-10-5: every second diagonal step costs double.
    case CONST.GRID_DIAGONALS.ALTERNATING_1:
    case CONST.GRID_DIAGONALS.ALTERNATING_2: {
      const [d0, d1] = [dx, dy, dz].sort((p, q) => q - p);
      const extra =
        grid.diagonals === CONST.GRID_DIAGONALS.ALTERNATING_1 ? Math.floor(d1 / 2) : Math.ceil(d1 / 2);
      return (d0 + extra) * gd;
    }

    case CONST.GRID_DIAGONALS.EQUIDISTANT:
      return Math.max(dx, dy, dz) * gd;

    case CONST.GRID_DIAGONALS.RECTILINEAR:
      return (dx + dy + dz) * gd;

    // EXACT / APPROXIMATE / ILLEGAL: defer to the grid rather than approximate them.
    default: {
      const gs = canvas.dimensions.size;
      return grid.measurePath([
        { x: a.x0 * gs, y: a.y0 * gs, elevation: a.elevation },
        { x: b.x0 * gs, y: b.y0 * gs, elevation: b.elevation },
      ]).distance;
    }
  }
}

/**
 * Gridless: straight-line edge-to-edge, so a token half a square closer really is closer.
 * Elevation joins as a third euclidean axis rather than a grid step.
 */
function gridlessDistance(a, b, dzUnits) {
  const { size: gs, distance: gd } = canvas.dimensions;

  const dxPx = Math.max(0, a.px.left - b.px.right, b.px.left - a.px.right);
  const dyPx = Math.max(0, a.px.top - b.px.bottom, b.px.top - a.px.bottom);

  const planar = (Math.hypot(dxPx, dyPx) / gs) * gd;
  return dzUnits ? Math.hypot(planar, dzUnits) : planar;
}

/**
 * Hex: measured by the grid itself. Slower than the square path, but hex aura geometry is
 * not worth reimplementing to save microseconds on a rare scene type.
 *
 * measurePath is planar, so elevation is folded in afterwards.
 */
function hexDistance(a, b, dzUnits) {
  const gs = canvas.dimensions.size;
  const centre = (r) => ({ x: (r.px.left + r.px.right) / 2, y: (r.px.top + r.px.bottom) / 2 });

  const planar = canvas.grid.measurePath([centre(a), centre(b)]).distance;
  // Centre-to-centre overshoots by each token's own radius; charge only the gap between them.
  const radii = ((a.px.right - a.px.left) / 2 + (b.px.right - b.px.left) / 2) / gs;
  const edge = Math.max(0, planar - radii * canvas.dimensions.distance);

  return dzUnits ? Math.hypot(edge, dzUnits) : edge;
}

/** True when b is within `radius` scene units of a. */
export function inRange(aDoc, bDoc, radius, opts) {
  return distance(aDoc, bDoc, opts) <= radius;
}

/** Every grid type is handled: square directly, gridless euclidean, hex via measurePath. */
export function gridSupported() {
  return !!canvas.grid;
}
