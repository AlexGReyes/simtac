export function puntoValido(value) {
  return value && typeof value.x === 'number' && typeof value.y === 'number' &&
    Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Math.abs(value.x) <= 180 && Math.abs(value.y) <= 90;
}

function distanciaKm(first, second) {
  const radians = Math.PI / 180;
  const latitude = (second.y - first.y) * radians;
  const longitude = (second.x - first.x) * radians;
  const haversine = Math.sin(latitude / 2) ** 2 +
    Math.cos(first.y * radians) * Math.cos(second.y * radians) * Math.sin(longitude / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function prepararRuta(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2 || !waypoints.every(puntoValido)) return null;
  const points = waypoints.map(value => Object.freeze({ ...value }))
    .filter((value, index, array) => !index || value.x !== array[index - 1].x || value.y !== array[index - 1].y);
  if (points.length < 2) return null;
  const cumulativeM = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeM.push(cumulativeM[index - 1] + distanciaKm(points[index - 1], points[index]) * 1000);
  }
  return Object.freeze({ points: Object.freeze(points),
    cumulativeM: Object.freeze(cumulativeM), totalKm: cumulativeM.at(-1) / 1000 });
}

export function posicionEnRuta(route, progressKm) {
  if (!route || typeof progressKm !== 'number' || !Number.isFinite(progressKm)) return null;
  if (progressKm <= 0) return { ...route.points[0] };
  if (progressKm >= route.totalKm) return { ...route.points.at(-1) };
  const targetM = progressKm * 1000;
  let lower = 1;
  let upper = route.points.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (route.cumulativeM[middle] < targetM) lower = middle + 1;
    else upper = middle;
  }
  const first = route.points[lower - 1];
  const second = route.points[lower];
  const fraction = (targetM - route.cumulativeM[lower - 1]) /
    (route.cumulativeM[lower] - route.cumulativeM[lower - 1]);
  if (fraction === 0) return { ...first };
  if (fraction === 1) return { ...second };
  const radians = Math.PI / 180;
  const angle = distanciaKm(first, second) / 6371;
  const firstWeight = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const secondWeight = Math.sin(fraction * angle) / Math.sin(angle);
  const horizontal = firstWeight * Math.cos(first.y * radians) * Math.cos(first.x * radians) +
    secondWeight * Math.cos(second.y * radians) * Math.cos(second.x * radians);
  const vertical = firstWeight * Math.cos(first.y * radians) * Math.sin(first.x * radians) +
    secondWeight * Math.cos(second.y * radians) * Math.sin(second.x * radians);
  const height = firstWeight * Math.sin(first.y * radians) + secondWeight * Math.sin(second.y * radians);
  return { x: Math.atan2(vertical, horizontal) / radians,
    y: Math.atan2(height, Math.hypot(horizontal, vertical)) / radians };
}
