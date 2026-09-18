import { test, expect } from '@playwright/test';

const baseUrl = process.env.SIMTAC_BROWSER_URL || 'http://127.0.0.1:3102';

test('dos visores: ruta integral real a 80 km/h, curvas, reconexión y agua bloqueada', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  const errors = [];
  pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
  for (const [index, page] of pages.entries()) {
    await page.goto(`${baseUrl}/pruebas/mapa.html?actor=${index + 5}&backend=${encodeURIComponent(baseUrl)}&geoserver=http://localhost:3001/geoserver`);
    await page.waitForFunction(() => window.harness?.Store.obtener('unidad', 1));
  }
  const [first, second] = pages;
  const fixture = await first.evaluate(() => fetch('/test-case').then(response => response.json()));
  await first.evaluate(() => harness.Socket.emitir('test:reset', { landmark: true }));
  for (const page of pages) await expect.poll(() => page.evaluate(() => {
    const entity = harness.Store.obtener('unidad', 1).entidad;
    return { x: entity.posicion_x, y: entity.posicion_y };
  })).toEqual(fixture.origin);
  const order = await first.evaluate(destination => harness.Movimiento.enviarMovimiento(
    harness.Store.obtener('unidad', 1), destination), fixture.destination);
  expect(order?.routeId).toBeTruthy();
  expect(order.segmentos.map(segment => segment.kind)).toEqual(
    ['acceso_origen', 'vial', 'acceso_destino']);
  for (const page of pages) {
    await expect.poll(() => page.evaluate(() => harness.routes().length)).toBe(1);
    const geometry = await page.evaluate(() => harness.routes()[0].getGeometry().getCoordinates());
    expect(geometry).toEqual(order.waypoints.map(point => [point.x, point.y]));
    expect(await page.evaluate(() => harness.routes()[0].get('identidadMovimiento').routeId)).toBe(order.routeId);
  }
  await first.waitForTimeout(2400);
  for (const page of pages) {
    const distance = await page.evaluate(() => harness.Store.obtener('unidad', 1).entidad.distancia_recorrida);
    expect(distance).toBeGreaterThan(0.02);
    expect(distance).toBeLessThan(0.09);
  }
  await first.evaluate(() => harness.Mapa.instancia().getView().fit(harness.routes()[0].getGeometry().getExtent(), { padding: [50, 50, 50, 50] }));
  await first.waitForTimeout(500);
  await first.screenshot({ path: 'test-results/toreo-toluca.png' });
  await first.evaluate(() => harness.Socket.emitir('entidad:cancelar_movimiento', { ejercicio_id: 1, entidad_tipo: 'unidad', entidad_id: 1 }));
  for (const page of pages) await expect.poll(() => page.evaluate(() => harness.routes().length)).toBe(0);
  await first.evaluate(() => harness.Socket.emitir('test:reset', {}));
  await first.waitForTimeout(200);
  const curved = await first.evaluate(() => harness.Socket.emitir('test:curve', {}));
  const samples = await second.evaluate(() => new Promise(resolve => {
    const values = [];
    const end = performance.now() + 6500;
    const sample = () => {
      values.push({ position: harness.marker(), time: performance.now() });
      if (performance.now() < end) requestAnimationFrame(sample);
      else resolve(values);
    };
    requestAnimationFrame(sample);
  }));
  expect(samples.length).toBeGreaterThan(20);
  for (const { position: [longitude, latitude] } of samples) {
    expect(Math.min(Math.abs(latitude - curved.waypoints[0].y), Math.abs(longitude - curved.waypoints[1].x))).toBeLessThan(1e-7);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const distanceKm = Math.hypot(current.position[0] - previous.position[0], current.position[1] - previous.position[1]) * 111.32;
    expect(distanceKm).toBeLessThan(80 / 3600000 * (current.time - previous.time) * 1.2 + 0.002);
  }
  for (const page of pages) await expect.poll(() => page.evaluate(() => harness.routes().length)).toBe(0);
  await first.evaluate(() => harness.Socket.emitir('test:curve', {}));
  await first.waitForTimeout(1200);
  await second.evaluate(() => harness.Socket.crudo().disconnect());
  for (const page of pages) await expect.poll(() => page.evaluate(() => harness.routes().length)).toBe(0);
  await second.evaluate(() => harness.Socket.crudo().connect());
  await second.waitForFunction(() => harness.Socket.conectado());
  await second.waitForTimeout(300);
  expect(await second.evaluate(() => harness.routes().length)).toBe(0);
  await first.evaluate(() => harness.Socket.emitir('test:reset', { landmark: true }));
  await first.waitForTimeout(200);
  const rejected = await first.evaluate(async destination => {
    try { await harness.Socket.emitir('entidad:mover', { ejercicio_id: 1, entidad_tipo: 'unidad', entidad_id: 1,
      posicion_fin: destination }, { timeoutMs: 90000 }); return 'UNEXPECTED_MOVEMENT'; }
    catch (error) { return error.code; }
  }, fixture.blockedDestination);
  expect(['ROUTE_NOT_TRAVERSABLE', 'TRAVERSABILITY_UNKNOWN']).toContain(rejected);
  for (const page of pages) {
    expect(await page.evaluate(() => harness.routes().length)).toBe(0);
    expect(await page.evaluate(() => {
      const entity = harness.Store.obtener('unidad', 1).entidad;
      return { x: entity.posicion_x, y: entity.posicion_y };
    })).toEqual(fixture.origin);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test('cliente desplegado: abre login y consulta backend sin errores de JavaScript', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8082/');
  await expect(page.locator('#login-screen')).toBeVisible();
  const health = await page.evaluate(() => fetch('http://node.localhost/health').then(response => response.json()));
  expect(health.status).toBe('ok');
  expect(errors).toEqual([]);
});
