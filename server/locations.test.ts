import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityFromAddress, countryName, parseLocationCard, parseLocationsFromHtml, tidyLocations } from './locations.js';
import { geocode, geocodeQueries, mapsSearchLink, osmPrecision } from './geocode.js';

// The three cards on Santechture's LinkedIn page, as their lines read in the browser.
const CARDS = [
  [
    'United Arab Emirates',
    'Primary',
    'Headquarters',
    '2506 Mazaya Business Avenue BB2, Jumeirah Lakes Towers (JLT), Dubai, Dubai 346060',
    'Get directions',
  ],
  ['Saudi Arabia', 'Santechture Digital Ltd Saudi', 'King Fahd Road, 13th Floor - Ebdaa Tower, Al Olaya District - Riyadh, Riyadh 19248', 'Get directions'],
  ['Egypt', 'Santechture Software Solutions Egypt', '17 Markez Al Malomat, Sheraton Al Mata, El Nozha, Cairo, Cairo Governorate  4471303'],
];

test('countryName knows names, codes and short forms', () => {
  assert.equal(countryName('Egypt'), 'Egypt');
  assert.equal(countryName('AE'), 'United Arab Emirates');
  assert.equal(countryName('uae'), 'United Arab Emirates');
  assert.equal(countryName('KSA'), 'Saudi Arabia');
  assert.equal(countryName('Primary'), null);
  assert.equal(countryName(''), null);
});

test('cityFromAddress takes the part before the region', () => {
  assert.equal(cityFromAddress('2506 Mazaya Business Avenue BB2, Jumeirah Lakes Towers (JLT), Dubai, Dubai 346060'), 'Dubai');
  assert.equal(cityFromAddress('King Fahd Road, 13th Floor - Ebdaa Tower, Al Olaya District - Riyadh, Riyadh 19248'), 'Riyadh');
  assert.equal(cityFromAddress('17 Markez Al Malomat, Sheraton Al Mata, El Nozha, Cairo, Cairo Governorate 4471303'), 'Cairo');
  assert.equal(cityFromAddress('Smart Village, Giza, EG'), 'Smart Village');
  assert.equal(cityFromAddress('Cairo'), 'Cairo');
});

test('parseLocationCard reads country, tags and address', () => {
  const [uae, ksa, eg] = CARDS.map((c) => parseLocationCard(c)!);
  assert.deepEqual(uae, {
    label: 'Primary · Headquarters',
    address: '2506 Mazaya Business Avenue BB2, Jumeirah Lakes Towers (JLT), Dubai, Dubai 346060',
    city: 'Dubai',
    country: 'United Arab Emirates',
    is_primary: true,
  });
  assert.equal(ksa.label, 'Santechture Digital Ltd Saudi');
  assert.equal(ksa.country, 'Saudi Arabia');
  assert.equal(ksa.city, 'Riyadh');
  assert.equal(ksa.is_primary, false);
  assert.equal(eg.country, 'Egypt');
  assert.equal(eg.city, 'Cairo');
});

test('parseLocationCard: country from a heading, a city-only card, nothing', () => {
  const l = parseLocationCard(['Smart Village, Building B12, Giza 12577'], 'Egypt')!;
  assert.equal(l.country, 'Egypt');
  assert.equal(l.label, null);
  assert.equal(parseLocationCard(['Cairo'])!.address, 'Cairo');
  assert.equal(parseLocationCard(['Get directions']), null);
});

test('tidyLocations drops repeats and keeps exactly one primary', () => {
  const a = { label: null, address: 'A St, Cairo', city: 'Cairo', country: 'Egypt', is_primary: false };
  const b = { ...a, address: 'B St, Giza', is_primary: true };
  const c = { ...b, address: 'C St, Giza', is_primary: true };
  const out = tidyLocations([a, { ...a, address: 'a st,  cairo' }, b, c, null]);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((l) => l.is_primary),
    [false, true, false],
  );
  assert.equal(tidyLocations([a])[0].is_primary, true);
});

test('parseLocationsFromHtml: public page cards', () => {
  const html = `<section class="locations"><h2>Locations</h2><ul>
    <li><div id="address-0" class="x"><p class="t">Primary</p>
      <div><p>2506 Mazaya Business Avenue BB2</p><p>Dubai, Dubai 346060, AE</p></div>
      <a href="https://www.bing.com/maps?where=2506+Mazaya&amp;trk=org-locations_url">Get directions</a></div></li>
    <li><div id="address-1"><div><p>King Fahd Road</p><p>Riyadh, Riyadh 19248, SA</p></div>
      <a href="https://www.bing.com/maps?where=King+Fahd">Get directions</a></div></li>
  </ul></section>`;
  const out = parseLocationsFromHtml(html);
  assert.equal(out.length, 2);
  assert.equal(out[0].is_primary, true);
  assert.equal(out[0].country, 'United Arab Emirates');
  assert.equal(out[0].city, 'Dubai');
  assert.equal(out[1].country, 'Saudi Arabia');
  assert.equal(out[1].city, 'Riyadh');
});

test('parseLocationsFromHtml: logged-in page data and plain map links', () => {
  const data = `<code>{&quot;address&quot;:{&quot;country&quot;:&quot;EG&quot;,&quot;geographicArea&quot;:&quot;Cairo Governorate&quot;,&quot;city&quot;:&quot;Cairo&quot;,&quot;postalCode&quot;:&quot;4471303&quot;,&quot;line1&quot;:&quot;17 Markez Al Malomat&quot;,&quot;line2&quot;:&quot;El Nozha&quot;},&quot;headquarter&quot;:true}</code>`;
  const [eg] = parseLocationsFromHtml(data);
  assert.equal(eg.address, '17 Markez Al Malomat, El Nozha, Cairo, Cairo Governorate 4471303');
  assert.equal(eg.country, 'Egypt');
  assert.equal(eg.city, 'Cairo');
  assert.equal(eg.is_primary, true);

  const links = parseLocationsFromHtml('<a href="https://www.bing.com/maps?where=Smart+Village%2C+Giza%2C+EG">Get directions</a>');
  assert.equal(links.length, 1);
  assert.equal(links[0].country, 'Egypt');
  assert.deepEqual(parseLocationsFromHtml('<html>nothing here</html>'), []);
});

test('geocodeQueries drops floors and postal codes, then widens', () => {
  const q = geocodeQueries({
    address: 'King Fahd Road, 13th Floor - Ebdaa Tower, Al Olaya District - Riyadh, Riyadh 19248',
    city: 'Riyadh',
    country: 'Saudi Arabia',
  });
  assert.equal(q[0], 'King Fahd Road, Ebdaa Tower, Al Olaya District, Riyadh, Saudi Arabia');
  assert.equal(q[1], 'Ebdaa Tower, Riyadh, Saudi Arabia');
  assert.ok(q.includes('Riyadh, Saudi Arabia'));
  assert.ok(q.length <= 6);
  assert.ok(!q.some((x) => /13th|19248/.test(x)));
  assert.deepEqual(geocodeQueries({ address: null, city: 'Cairo', country: 'Egypt' }), ['Cairo, Egypt']);
});

test('osmPrecision maps place types', () => {
  assert.equal(osmPrecision('building'), 'exact');
  assert.equal(osmPrecision('road'), 'street');
  assert.equal(osmPrecision('suburb'), 'area');
  assert.equal(osmPrecision('city'), 'city');
});

test('geocode falls back to wider searches (OpenStreetMap)', async () => {
  const asked: string[] = [];
  const fetchFn = async (url: string) => {
    const q = new URL(url).searchParams.get('q')!;
    asked.push(q);
    const body = q.startsWith('Ebdaa Tower') ? [{ lat: '24.7', lon: '46.68', addresstype: 'building' }] : [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const hit = await geocode(
    { address: 'King Fahd Road, 13th Floor - Ebdaa Tower, Al Olaya District - Riyadh, Riyadh 19248', city: 'Riyadh', country: 'Saudi Arabia' },
    { fetchFn, delayMs: 0 },
  );
  assert.deepEqual(hit, { lat: 24.7, lng: 46.68, precision: 'exact', query: 'Ebdaa Tower, Riyadh, Saudi Arabia' });
  assert.equal(asked.length, 2);
});

test('geocode uses Google when a key is set, and reports a refused key', async () => {
  const ok = async () =>
    new Response(JSON.stringify({ status: 'OK', results: [{ geometry: { location: { lat: 25.07, lng: 55.14 }, location_type: 'ROOFTOP' } }] }));
  const hit = await geocode({ address: 'Mazaya Business Avenue', city: 'Dubai', country: 'United Arab Emirates' }, { googleKey: 'k', fetchFn: ok });
  assert.equal(hit?.precision, 'exact');
  const denied = async () => new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'bad key' }));
  await assert.rejects(geocode({ address: 'x', city: null, country: null }, { googleKey: 'k', fetchFn: denied }), /bad key/);
});

test('mapsSearchLink adds the country once', () => {
  assert.equal(
    mapsSearchLink({ address: 'King Fahd Road, Riyadh', city: 'Riyadh', country: 'Saudi Arabia' }),
    'https://www.google.com/maps/search/?api=1&query=King%20Fahd%20Road%2C%20Riyadh%2C%20Saudi%20Arabia',
  );
  assert.ok(mapsSearchLink({ address: 'Cairo, Egypt', city: null, country: 'Egypt' }).endsWith('Cairo%2C%20Egypt'));
});
