"""SS-102 pure reference. No business writes, schedulers or alerts."""
import copy
import math
from datetime import datetime, timedelta, timezone

VERSION = 'coingecko_warming_growth_v1'
CONTEXT = ('source_id', 'source_object_id', 'quote_currency', 'coverage_key')


def time(value):
    try:
        d = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return d.astimezone(timezone.utc) if d.tzinfo else None
    except (ValueError, TypeError, AttributeError):
        return None


def iso(d):
    return d.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def finite(x, positive=False):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and (x > 0 if positive else x >= 0)


def match(a, b):
    return all(a.get(k) == b.get(k) for k in CONTEXT)


def historical(current, history, target, minutes):
    valid, signatures = [], {}
    for r in history:
        requested, received, observed = [time(r.get(k)) for k in ('requested_at', 'collected_at', 'observed_at')]
        if not (match(current, r) and r.get('observation_id') and r.get('quality_status') == 'healthy'
                and finite(r.get('total_volume')) and requested and received and observed
                and observed <= received and requested <= received <= target
                and target - timedelta(minutes=minutes) <= requested <= target
                and observed >= target - timedelta(minutes=minutes)):
            continue
        sig = tuple(r.get(k) for k in (*CONTEXT, 'observation_id', 'asset_id', 'requested_at', 'collected_at', 'observed_at', 'total_volume'))
        key = r['observation_id']
        if key in signatures and signatures[key] != sig:
            return 'conflicting_history', None
        signatures[key] = sig
        valid.append(r)
    if not valid:
        return 'missing_history', None
    r = min(valid, key=lambda x: (-time(x['requested_at']).timestamp(), x['observation_id']))
    return 'complete', {'target_at': iso(target), **{k: r[k] for k in ('observation_id', 'requested_at', 'collected_at', 'observed_at', 'total_volume')}}


def daily_baseline(current, history, frozen=None):
    anchor = time(current.get('requested_at'))
    at = anchor.replace(hour=0, minute=0, second=0, microsecond=0) if anchor else None
    result = dict(warming_baseline_mean_7d=None, warming_baseline_days=0, warming_baseline_refs_json=[],
                  warming_baseline_at=iso(at) if at else None, warming_baseline_status='invalid_context')
    if not at or current.get('quote_currency') != 'usd' or not all(current.get(k) for k in CONTEXT):
        return result
    if frozen is not None:
        refs = frozen.get('warming_baseline_refs_json')
        complete = frozen.get('warming_baseline_status') == 'complete'
        if (not match(current, frozen) or frozen.get('warming_baseline_at') != iso(at)
                or not all(k in frozen for k in result) or not isinstance(refs, list)
                or complete and (not finite(frozen.get('warming_baseline_mean_7d'), True)
                    or frozen.get('warming_baseline_days') != 7 or len(refs) != 7
                    or len({r.get('observation_id') for r in refs}) != 7 or not all(finite(r.get('total_volume')) for r in refs))):
            return {**result, 'warming_baseline_status': 'invalid_frozen_baseline'}
        return {k: copy.deepcopy(frozen.get(k)) for k in result}
    used = set()
    for day in range(1, 8):
        status, ref = historical(current, history, at - timedelta(days=day), 30)
        if status == 'conflicting_history':
            result['warming_baseline_status'] = status
            return result
        if ref and ref['observation_id'] not in used:
            used.add(ref['observation_id'])
            result['warming_baseline_refs_json'].append({'day': day, **ref})
    result['warming_baseline_days'] = len(used)
    if len(used) != 7:
        result['warming_baseline_status'] = 'missing_history'
        return result
    mean = sum(r['total_volume'] / 7 for r in result['warming_baseline_refs_json'])
    if not finite(mean, True):
        result['warming_baseline_status'] = 'zero_or_nonfinite_baseline'
        return result
    return {**result, 'warming_baseline_mean_7d': mean, 'warming_baseline_status': 'complete'}


def metrics(current, history, frozen=None):
    r = {**daily_baseline(current, history, frozen), 'warming_multiple': None, 'history_1h_volume': None,
         'history_1h_ref_json': None, 'history_2h_volume': None, 'history_2h_ref_json': None, 'growth_1h': None,
         'previous_growth_1h': None, 'growth_change_pp': None, 'growth_change_status': 'unknown',
         'warming_status': 'invalid_current_volume'}
    if not finite(current.get('total_volume')):
        return r
    if r['warming_baseline_status'] != 'complete':
        return {**r, 'warming_status': r['warming_baseline_status']}
    r['warming_multiple'] = current['total_volume'] / r['warming_baseline_mean_7d']
    anchor = time(current['requested_at'])
    status, one = historical(current, history, anchor - timedelta(hours=1), 15)
    r.update(history_1h_ref_json=one, history_1h_volume=one['total_volume'] if one else None)
    if status != 'complete':
        return {**r, 'warming_status': 'conflicting_1h_history' if status == 'conflicting_history' else 'missing_1h_history'}
    if not finite(r['history_1h_volume'], True):
        return {**r, 'warming_status': 'zero_1h_history'}
    r['growth_1h'] = current['total_volume'] / r['history_1h_volume'] - 1
    if not math.isfinite(r['growth_1h']) or not finite(r['warming_multiple']):
        return {**r, 'growth_1h': None, 'warming_multiple': None, 'warming_status': 'nonfinite_metrics'}
    status, two = historical(current, history, anchor - timedelta(hours=2), 15)
    r.update(history_2h_ref_json=two, history_2h_volume=two['total_volume'] if two else None)
    if status == 'complete' and finite(r['history_2h_volume'], True):
        previous = r['history_1h_volume'] / r['history_2h_volume'] - 1
        change = (r['growth_1h'] - previous) * 100
        if math.isfinite(previous) and math.isfinite(change):
            r.update(previous_growth_1h=previous, growth_change_pp=change,
                     growth_change_status='steady' if abs(change) <= 1e-9 else 'accelerating' if change > 0 else 'slowing')
    return {**r, 'warming_status': 'complete'}


def board(rows, history, calculated_at, coverage='healthy', frozen_baselines=None):
    now = time(calculated_at)
    result = dict(algorithm_version=VERSION, calculated_at=calculated_at, status='unavailable', reason=None,
                  rows=[], candidates=[], excluded=[], sample_count=0, excluded_count=0, warming_warmup=False)
    if not now or coverage != 'healthy':
        return {**result, 'reason': 'coverage_unavailable' if now else 'invalid_calculation_time'}
    latest, observations, identities, sources = {}, {}, {}, {}
    for r in rows:
        asset = r.get('asset_id')
        if not asset or not r.get('source_object_id'):
            result['excluded'].append({'asset_id': asset, 'reason': 'identity_unresolved'})
            continue
        if not time(r.get('requested_at')) or not time(r.get('collected_at')):
            return {**result, 'reason': 'invalid_observation_time'}
        if (time(r.get('collected_at')) and time(r['collected_at']) > now or
                time(r.get('requested_at')) and time(r['requested_at']) > now):
            result['excluded'].append({'asset_id': asset, 'reason': 'future_observation'})
            continue
        source = (r.get('source_id'), r['source_object_id'])
        key = (*source, r.get('observation_id'))
        if key in observations and observations[key] != r:
            return {**result, 'reason': 'conflicting_observation'}
        observations[key] = r
        if (source in identities and identities[source] != asset or asset in sources and sources[asset] != source):
            return {**result, 'reason': 'conflicting_identity'}
        identities[source], sources[asset] = asset, source
        prior = latest.get(asset)
        requested = time(r.get('requested_at'))
        if not prior or (requested and (not time(prior.get('requested_at')) or requested > time(prior['requested_at'])
                or requested == time(prior['requested_at']) and str(r.get('observation_id')) < str(prior.get('observation_id')))):
            latest[asset] = r
    scopes, ranked, complete = set(), [], 0
    for asset, row in sorted(latest.items()):
        requested, received, observed = [time(row.get(k)) for k in ('requested_at', 'collected_at', 'observed_at')]
        reason = None
        if row.get('identity_status') != 'resolved' or row.get('object_kind') != 'coin':
            reason = 'identity_unresolved'
        elif row.get('metric_version') != 'market_indicators_v2':
            reason = 'unsupported_metric_version'
        elif row.get('quality_status') != 'healthy' or row.get('quote_currency') != 'usd' or not all(row.get(k) for k in CONTEXT):
            reason = 'invalid_quality_or_context'
        elif not (requested and received and observed and requested <= received <= now and observed <= received and observed >= now - timedelta(minutes=15)):
            reason = 'invalid_or_stale_time'
        elif (not all(row.get(k) for k in ('observation_id', 'metric_id', 'snapshot_ref')) or not finite(row.get('total_volume'))
                or not finite(row.get('current_price'), True) or not finite(row.get('market_cap'), True)):
            reason = 'invalid_current_values'
        if reason:
            result['excluded'].append({'asset_id': asset, 'reason': reason})
            continue
        result['sample_count'] += 1
        scopes.add((row['source_id'], row['quote_currency'], row['coverage_key']))
        candidate = {**row, **metrics(row, history, (frozen_baselines or {}).get(row['source_object_id']))}
        result['candidates'].append(candidate)
        if candidate['warming_status'] != 'complete':
            reason = candidate['warming_status']
        else:
            complete += 1
            if candidate['warming_multiple'] <= 1:
                reason = 'not_above_baseline'
            elif candidate['growth_1h'] <= 0:
                reason = 'not_growing'
        if reason:
            result['excluded'].append({'asset_id': asset, 'reason': reason})
        else:
            ranked.append(candidate)
    if len(scopes) > 1:
        return {**result, 'reason': 'mixed_batch_context', 'candidates': [], 'sample_count': 0}
    result['excluded_count'] = len(result['excluded'])
    result['warming_warmup'] = result['sample_count'] > 0 and complete == 0
    if result['warming_warmup']:
        return {**result, 'status': 'insufficient_history', 'reason': 'no_complete_metrics'}
    if rows and result['sample_count'] == 0:
        return {**result, 'reason': 'no_valid_current_candidates'}
    result['status'] = 'success'
    ranked.sort(key=lambda x: (-x['growth_1h'], -x['warming_multiple'], x['asset_id']))
    for i, r in enumerate(ranked[:10]):
        move = r.get('price_change_percentage_24h')
        result['rows'].append({**r, 'rank': i+1, 'score': r['growth_1h'], 'object_key': 'asset/'+r['asset_id'],
            'algorithm_version': VERSION, 'calculation_status': 'success',
            'snapshot_id': r['coverage_key']+'/'+calculated_at+'/'+VERSION, 'calculated_at': calculated_at,
            'source_as_of': calculated_at, 'sample_count': result['sample_count'], 'excluded_count': result['excluded_count'],
            'excluded_reasons_json': result['excluded'], 'warming_warmup': False,
            'reason': f"1h growth {r['growth_1h']*100:.2f}%; baseline {r['warming_multiple']:.2f}x",
            'trend_status': 'warming', 'price_direction': 'unknown' if not isinstance(move, (int, float)) else 'up' if move > 0 else 'down' if move < 0 else 'flat',
            'observation_refs_json': [r['observation_id']]+[x['observation_id'] for x in r['warming_baseline_refs_json']]
                +[r['history_1h_ref_json']['observation_id']]+([r['history_2h_ref_json']['observation_id']] if r['history_2h_ref_json'] else []),
            'run_id': r.get('run_id', 'design:round:'+calculated_at), 'window_label': 'rolling_24h_with_1h_comparison',
            'window_start': None, 'window_end': None})
    return result


def snapshot_is_current(batch, now):
    current, calculated = time(now), time(batch.get('calculated_at'))
    return bool(batch.get('status') == 'success' and current and calculated and timedelta(0) <= current - calculated < timedelta(minutes=15))
