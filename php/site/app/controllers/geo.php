<?php
// Geo-fenced attendance: the admin sets the office location(s); check-in and check-out only work from inside one of them.
// Mirrors server/src/controllers/geo.js and server/src/services/geo.js.

function geo_load(): array
{
    $s = q_one('SELECT * FROM geo_settings WHERE id = 1');
    $locs = array_map(fn($l) => [
        'id' => (int) $l['id'], 'name' => $l['name'], 'latitude' => (float) $l['latitude'], 'longitude' => (float) $l['longitude'],
        'radius_m' => (int) $l['radius_m'], 'active' => (bool) $l['active'], 'created_at' => $l['created_at'], 'updated_at' => $l['updated_at'],
    ], q_all('SELECT * FROM office_locations ORDER BY id'));
    return ['enabled' => (bool) $s['enabled'] && features_of(company())['geo'], 'max_accuracy_m' => (int) $s['max_accuracy_m'], 'locations' => $locs];
}

// Distance between two points on the earth, in metres (haversine).
function geo_distance(float $lat1, float $lng1, float $lat2, float $lng2): float
{
    $R = 6371000;
    $a = sin(deg2rad($lat2 - $lat1) / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin(deg2rad($lng2 - $lng1) / 2) ** 2;
    return 2 * $R * asin(sqrt($a));
}

// Checks the position sent with a check-in / check-out. When the admin has switched the location check on, a punch without a
// position, with a vague position, or from outside every office location is refused. Returns the columns to store, or [].
function geo_verify_punch(string $prefix): array
{
    $b = req_body();
    $has = fn($k) => isset($b[$k]) && $b[$k] !== '' && is_numeric($b[$k]);
    $ok = $has('latitude') && $has('longitude') && abs((float) $b['latitude']) <= 90 && abs((float) $b['longitude']) <= 180;
    $lat = $ok ? (float) $b['latitude'] : 0.0;
    $lng = $ok ? (float) $b['longitude'] : 0.0;
    $acc = $has('accuracy') ? (float) $b['accuracy'] : null;
    $geo = geo_load();
    if (!$geo['enabled']) {
        return $ok ? ["{$prefix}_lat" => $lat, "{$prefix}_lng" => $lng, "{$prefix}_accuracy" => $acc === null ? null : (int) round($acc)] : [];
    }
    if (!$ok) {
        throw new HttpError(400, 'Your location is required. Allow location access in your browser (the padlock next to the address) and try again.');
    }
    if ($acc === null || $acc > $geo['max_accuracy_m']) {
        throw new HttpError(400, 'Your phone or computer could not find your location precisely enough' . ($acc === null ? '' : ' (' . (int) round($acc) . ' m)') . '. Turn on GPS or Wi-Fi, move near a window, and try again.');
    }
    $best = null;
    foreach ($geo['locations'] as $l) {
        if (!$l['active']) { continue; }
        $d = geo_distance($lat, $lng, $l['latitude'], $l['longitude']);
        if ($best === null || $d - $l['radius_m'] < $best['d'] - $best['l']['radius_m']) {
            $best = ['l' => $l, 'd' => $d];
        }
    }
    if ($best === null) {
        throw new HttpError(403, 'No office location has been set up. Please ask your admin.');
    }
    if ($best['d'] > $best['l']['radius_m']) {
        $far = $best['d'] >= 1000 ? number_format($best['d'] / 1000, 1) . ' km' : (int) round($best['d']) . ' m';
        throw new HttpError(403, "You are $far away from {$best['l']['name']}. You can only check in within {$best['l']['radius_m']} m of the office.");
    }
    return ["{$prefix}_lat" => $lat, "{$prefix}_lng" => $lng, "{$prefix}_accuracy" => (int) round($acc), "{$prefix}_location" => $best['l']['name']];
}

// What an employee needs to know before punching: is the check on, and which places count. No coordinates are shown.
function geo_public(): void
{
    $g = geo_load();
    respond(['enabled' => $g['enabled'], 'max_accuracy_m' => $g['max_accuracy_m'], 'locations' => array_values(array_map(fn($l) => ['id' => $l['id'], 'name' => $l['name'], 'radius_m' => $l['radius_m']], array_filter($g['locations'], fn($l) => $l['active'])))]);
}

function geo_admin(): void
{
    require_admin();
    respond(geo_load());
}

function geo_settings_update(): void
{
    require_admin();
    $v = new V(req_body());
    $enabled = (bool) $v->bool('enabled');
    $acc = (int) $v->num('max_accuracy_m', 20, 1000);
    $v->done();
    $g = geo_load();
    if ($enabled && !array_filter($g['locations'], fn($l) => $l['active'])) {
        throw new HttpError(400, 'Add at least one office location before switching the location check on.');
    }
    q_update('geo_settings', ['enabled' => $enabled ? 1 : 0, 'max_accuracy_m' => $acc, 'updated_at' => ts()], 'id = ?', [1]);
    audit('geo_settings', 1, 'update', ['enabled' => $g['enabled'], 'max_accuracy_m' => $g['max_accuracy_m']], ['enabled' => $enabled, 'max_accuracy_m' => $acc]);
    respond(geo_load());
}

function geo_location_input(): array
{
    $v = new V(req_body());
    $d = [
        'name' => $v->str('name', 2, 100), 'latitude' => $v->num('latitude', -90, 90), 'longitude' => $v->num('longitude', -180, 180),
        'radius_m' => (int) $v->num('radius_m', 20, 5000), 'active' => $v->has('active') ? ($v->bool('active') ? 1 : 0) : 1,
    ];
    $v->done();
    return $d;
}

function geo_assert_covered(int $id, bool $willBeActive): void
{
    $g = geo_load();
    if ($g['enabled'] && !$willBeActive && !array_filter($g['locations'], fn($l) => $l['active'] && $l['id'] !== $id)) {
        throw new HttpError(400, 'The location check is on, so at least one office location must stay active. Switch the check off first.');
    }
}

function geo_location_add(): void
{
    require_admin();
    $d = geo_location_input();
    $id = q_insert('office_locations', $d + ['created_at' => ts(), 'updated_at' => ts()]);
    audit('office_location', $id, 'create', null, $d);
    respond(['id' => $id], 201);
}

function geo_location_update(array $p): void
{
    require_admin();
    $l = q_one('SELECT * FROM office_locations WHERE id = ?', [(int) $p['id']]);
    if (!$l) {
        throw new HttpError(404, 'Location not found');
    }
    $d = geo_location_input();
    geo_assert_covered((int) $l['id'], (bool) $d['active']);
    q_update('office_locations', $d + ['updated_at' => ts()], 'id = ?', [$l['id']]);
    audit('office_location', $l['id'], 'update', $l, $d);
    respond(['ok' => true]);
}

function geo_location_delete(array $p): void
{
    require_admin();
    $l = q_one('SELECT * FROM office_locations WHERE id = ?', [(int) $p['id']]);
    if (!$l) {
        throw new HttpError(404, 'Location not found');
    }
    geo_assert_covered((int) $l['id'], false);
    q_run('DELETE FROM office_locations WHERE id = ?', [$l['id']]);
    audit('office_location', $l['id'], 'delete', $l);
    no_content();
}
