import { distanciaMetros } from './geo.js';

function punto(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function prepararRuta(waypoints) {
  const points = (Array.isArray(waypoints) ? waypoints : []).map(punto).filter(Boolean);
  if (points.length < 2) return null;
  const cumulativeM = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeM.push(cumulativeM[index - 1] + distanciaMetros(points[index - 1], points[index]));
  }
  return { points, cumulativeM, totalKm: cumulativeM.at(-1) / 1000 };
}

export function posicionEnRuta(route, progressKm) {
  if (!route || !Number.isFinite(Number(progressKm))) return null;
  const targetM = Math.max(0, Math.min(route.totalKm, Number(progressKm))) * 1000;
  let index = 1;
  while (index < route.cumulativeM.length && route.cumulativeM[index] < targetM) index += 1;
  const start = route.points[index - 1];
  const end = route.points[index];
  const length = route.cumulativeM[index] - route.cumulativeM[index - 1];
  const ratio = length === 0 ? 0 : (targetM - route.cumulativeM[index - 1]) / length;
  return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
}
