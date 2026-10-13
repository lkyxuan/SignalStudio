"""SS-95 pure design evaluator. No collectors, consumers, database or score writes."""
import math
from datetime import datetime, timedelta
from statistics import median, fmean

VERSION = 'coingecko_hottest_z_v1'
METRIC_VERSION = 'market_indicators_v2'
WEIGHTS = {'rvol_7d': .35, 'volume_to_market_cap': .25, 'total_volume': .20, 'abs_price_pct': .20}
CONTEXT = ('source_id', 'source_object_id', 'quote_currency', 'coverage_key')
SCALE_EPSILON = 1e-12


def time(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo else None
    except (ValueError, TypeError, AttributeError):
        return None


def finite(value, positive=False):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and (value > 0 if positive else value >= 0)


def baseline_7d(current, history):
    """Seven daily as-of observations, received by each target; no look-ahead."""
    anchor = time(current.get('requested_at'))
    result = {'baseline_mean_volume_7d': None, 'baseline_days_7d': 0,
              'baseline_refs_7d_json': [], 'rvol_7d': None, 'rvol_7d_status': 'invalid_context'}
    if not anchor or not all(current.get(k) for k in CONTEXT) or current.get('quote_currency') != 'usd':
        return result
    used = set()
    for day in range(1, 8):
        target = anchor - timedelta(days=day)
        valid = []
        for row in history:
            requested, collected, observed = (time(row.get(k)) for k in ('requested_at', 'collected_at', 'observed_at'))
            if (all(row.get(k) == current.get(k) for k in CONTEXT)
                    and row.get('quality_status') == 'healthy' and finite(row.get('total_volume'))
                    and row.get('observation_id') and row['observation_id'] not in used
                    and requested and collected and observed and observed <= collected
                    and requested <= collected <= target and target - timedelta(minutes=30) <= requested <= target):
                valid.append(row)
        if not valid:
            continue
        # Conflicting content under one observation ID is not a valid baseline.
        identity = {}
        conflict = False
        for row in valid:
            signature = tuple(row.get(k) for k in (*CONTEXT, 'requested_at', 'collected_at', 'observed_at', 'total_volume'))
            if row['observation_id'] in identity and identity[row['observation_id']] != signature:
                conflict = True
            identity[row['observation_id']] = signature
        if conflict:
            result['rvol_7d_status'] = 'conflicting_history'
            return result
        chosen = sorted(valid, key=lambda r: (-time(r['requested_at']).timestamp(), r['observation_id']))[0]
        used.add(chosen['observation_id'])
        result['baseline_refs_7d_json'].append({'day': day, 'target_at': target.isoformat(),
            'observation_id': chosen['observation_id'], 'requested_at': chosen['requested_at'],
            'collected_at': chosen['collected_at'], 'total_volume': chosen['total_volume']})
    result['baseline_days_7d'] = len(used)
    if len(used) != 7:
        result['rvol_7d_status'] = 'missing_history'
        return result
    mean = fmean(r['total_volume'] for r in result['baseline_refs_7d_json'])
    if not finite(mean, positive=True):
        result['rvol_7d_status'] = 'zero_baseline'
        return result
    result['baseline_mean_volume_7d'] = mean
    if not finite(current.get('total_volume')):
        result['rvol_7d_status'] = 'invalid_current_volume'
        return result
    ratio = current['total_volume'] / mean
    if not finite(ratio):
        result['rvol_7d_status'] = 'nonfinite_rvol'
        return result
    result.update(rvol_7d=ratio, rvol_7d_status='complete')
    return result


def normalize(values):
    transformed = [math.log1p(v) for v in values]
    center = median(transformed)
    mad = median(abs(v - center) for v in transformed)
    scale = 1.4826 * mad
    degenerate = scale <= SCALE_EPSILON
    raw = [0.0 if degenerate else (v - center) / scale for v in transformed]
    if not all(math.isfinite(v) for v in raw):
        raise ValueError('nonfinite normalization')
    return {'median': center, 'mad': mad, 'scale': scale, 'status': 'normalization_degenerate' if degenerate else 'ok',
            'transformed': transformed, 'z_raw': raw, 'z_clipped': [max(-3., min(3., v)) for v in raw]}


def board(rows, calculated_at, coverage_status='healthy'):
    """Freeze one batch, validate current candidates, normalize together, rank."""
    now = time(calculated_at)
    result = {'algorithm_version': VERSION, 'calculated_at': calculated_at, 'status': 'unavailable',
              'rows': [], 'excluded': [], 'sample_count': 0, 'normalization_json': {}}
    if not now or coverage_status != 'healthy':
        result['reason'] = 'coverage_unavailable' if now else 'invalid_calculation_time'
        return result
    latest, identities = {}, {}
    for row in rows:
        requested, collected, observed = (time(row.get(k)) for k in ('requested_at', 'collected_at', 'observed_at'))
        reason = None
        if row.get('identity_status') != 'resolved' or not row.get('asset_id') or row.get('object_kind') != 'coin':
            reason = 'identity_unresolved'
        elif row.get('metric_version') != METRIC_VERSION:
            reason = 'unsupported_metric_version'
        elif row.get('quality_status') != 'healthy' or row.get('quote_currency') != 'usd' or not all(row.get(k) for k in CONTEXT):
            reason = 'invalid_quality_or_context'
        elif not requested or not collected or not observed or not (requested <= collected <= now and observed <= collected and now - timedelta(minutes=15) <= observed):
            reason = 'invalid_or_stale_time'
        elif not finite(row.get('current_price'), True) or not finite(row.get('market_cap'), True) or not finite(row.get('total_volume')) or not finite(row.get('abs_price_pct')):
            reason = 'invalid_numeric'
        elif not row.get('observation_id') or not row.get('metric_id'):
            reason = 'missing_observation_identity'
        if reason:
            result['excluded'].append({'asset_id': row.get('asset_id'), 'reason': reason})
            continue
        key = (row['source_id'], row['source_object_id'])
        if key in identities and identities[key] != row['asset_id']:
            result['reason'] = 'conflicting_identity'
            return result
        identities[key] = row['asset_id']
        old = latest.get(row['asset_id'])
        if old and tuple(row.get(k) for k in CONTEXT) != tuple(old.get(k) for k in CONTEXT):
            result['reason'] = 'conflicting_asset_source'
            return result
        if old and row['observation_id'] == old['observation_id'] and row != old:
            result['reason'] = 'conflicting_observation'
            return result
        # Choose the latest observation BEFORE checking RVOL. Never silently reuse older complete history.
        if not old or (requested, row['observation_id']) > (time(old['requested_at']), old['observation_id']):
            latest[row['asset_id']] = dict(row)
    selected = []
    for row in sorted(latest.values(), key=lambda r: r['asset_id']):
        if row.get('rvol_7d_status') != 'complete' or row.get('baseline_days_7d') != 7 or not finite(row.get('rvol_7d')) or not finite(row.get('baseline_mean_volume_7d'), True):
            result['excluded'].append({'asset_id': row['asset_id'], 'reason': 'incomplete_rvol'})
            continue
        item = dict(row)
        item['volume_to_market_cap'] = row['total_volume'] / row['market_cap']
        if not finite(item['volume_to_market_cap']):
            result['excluded'].append({'asset_id': row['asset_id'], 'reason': 'invalid_turnover'})
            continue
        selected.append(item)
    result['sample_count'] = len(selected)
    if not selected:
        result.update(status='success', reason='empty_qualified_batch', excluded_count=len(result['excluded']))
        return result
    try:
        normalized = {k: normalize([r[k] for r in selected]) for k in WEIGHTS}
    except (ValueError, OverflowError):
        result['reason'] = 'nonfinite_normalization'
        return result
    result['normalization_json'] = {k: {f: v for f, v in n.items() if f not in ('transformed', 'z_raw', 'z_clipped')} for k, n in normalized.items()}
    if all(n['status'] != 'ok' for n in normalized.values()):
        result['reason'] = 'incomparable_batch'
        return result
    for i, row in enumerate(selected):
        components = {k: {'value': row[k], 'log1p': n['transformed'][i], 'z_raw': n['z_raw'][i],
                         'z_clipped': n['z_clipped'][i], 'weight': WEIGHTS[k], 'contribution': WEIGHTS[k] * n['z_clipped'][i],
                         'status': n['status']} for k, n in normalized.items()}
        row.update(score=sum(c['contribution'] for c in components.values()), score_components_json=components,
                   algorithm_version=VERSION, calculated_at=calculated_at, direction='up' if row['price_change_percentage_24h'] > 0 else 'down' if row['price_change_percentage_24h'] < 0 else 'flat')
    selected.sort(key=lambda r: (-r['score'], r['asset_id']))
    result['rows'] = [dict(row, rank=i+1) for i, row in enumerate(selected[:20])]
    result.update(status='success', reason=None, excluded_count=len(result['excluded']))
    return result


def snapshot_is_current(result, at):
    calculated, now = time(result.get('calculated_at')), time(at)
    return result.get('status') == 'success' and bool(calculated and now and 0 <= (now-calculated).total_seconds() < 900)
