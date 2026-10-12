"""Pure market_v1 reference calculations, not a collector, scheduler or Redis writer.

Callers must persist the first valid snapshot, decisions and publisher event IDs.
This module verifies math/contracts; it is deliberately not wired to app actions.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parent.parent / 'catalog/market-scoring.v1.json').read_text())
PARAMS = RULES['parameters']
POLICIES = {RULES['scoring']['policy_prefix'] + rule['key']: rule for rule in RULES['rules']}
ACTIVITY = [r['key'] for r in RULES['rules']]


def timestamp(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
    if not isinstance(stamp, datetime) or stamp.tzinfo is None:
        raise ValueError('Timezone-aware timestamp required')
    return stamp.astimezone(timezone.utc)


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def slot_start(value):
    seconds = timestamp(value).timestamp()
    width = PARAMS['evaluation_slot_minutes'] * 60
    return datetime.fromtimestamp(math.floor(seconds / width) * width, timezone.utc)


def tier_points(key, value):
    if not finite(value):
        return 0
    rule = next(r for r in RULES['rules'] if r['key'] == key)
    return max((points for minimum, points in rule['tiers'] if value >= minimum), default=0)


def eligible(observation, at):
    """Current public filter. Missing/invalid observations are not zero-valued facts."""
    try:
        at = timestamp(at)
        requested, collected, observed = (timestamp(observation[k]) for k in ('requested_at', 'collected_at', 'observed_at'))
        return (observation['source_id'] == PARAMS['source'] and observation['quote_currency'] == 'usd'
                and observation['identity_status'] == 'resolved' and bool(observation['asset_id'])
                and bool(observation['source_object_id']) and bool(observation['coverage_key'])
                and observation['quality_status'] == 'healthy'
                and requested <= collected <= at and observed <= collected
                and 0 <= (at - observed).total_seconds() <= PARAMS['max_source_age_minutes'] * 60
                and all(finite(observation[k]) for k in ('current_price', 'market_cap', 'total_volume', 'price_change_percentage_24h'))
                and observation['current_price'] > 0
                and observation['market_cap'] >= PARAMS['min_market_cap_usd']
                and observation['total_volume'] >= PARAMS['min_volume_24h_usd'])
    except (KeyError, ValueError, TypeError, OverflowError):
        return False


def volume_baseline(observation, history):
    target = timestamp(observation['requested_at']) - timedelta(hours=PARAMS['volume_baseline_hours'])
    matches = []
    for row in history:
        try:
            stamp = timestamp(row['requested_at'])
            if (all(row[k] == observation[k] for k in ('asset_id', 'source_id', 'source_object_id', 'quote_currency', 'coverage_key'))
                    and eligible(row, timestamp(row['collected_at']))
                    and timestamp(row['collected_at']) <= target
                    and 0 <= (target - stamp).total_seconds() <= PARAMS['volume_baseline_tolerance_minutes'] * 60
                    and row['total_volume'] >= PARAMS['min_baseline_volume_usd']):
                matches.append(row)
        except (KeyError, ValueError, TypeError, OverflowError):
            continue
    return max(matches, key=lambda r: timestamp(r['requested_at']), default=None)


METRIC_VERSION = 'market_indicators_v1'


def indicator_input_valid(observation, at, allow_source_only=False):
    """Shared provenance validation; board admission is a downstream concern."""
    try:
        at = timestamp(at)
        requested, collected, observed = (timestamp(observation[k]) for k in ('requested_at', 'collected_at', 'observed_at'))
        return (observation['source_id'] == PARAMS['source'] and observation['quote_currency'] == 'usd'
                and ((observation['identity_status'] == 'resolved' and bool(observation['asset_id']))
                     or (allow_source_only and observation['identity_status'] == 'source_only' and observation['asset_id'] is None))
                and bool(observation['source_object_id']) and bool(observation['coverage_key'])
                and bool(observation['observation_id']) and observation['quality_status'] == 'healthy'
                and requested <= collected <= at and observed <= collected
                and 0 <= (at - observed).total_seconds() <= PARAMS['max_source_age_minutes'] * 60)
    except (KeyError, ValueError, TypeError, OverflowError):
        return False


def source_volume_baseline(observation, history):
    """Source-only reference math: nullable UUIDs never identify or join coins."""
    target = timestamp(observation['requested_at']) - timedelta(hours=PARAMS['volume_baseline_hours'])
    matches = []
    for row in history:
        try:
            stamp = timestamp(row['requested_at'])
            if (all(row[k] == observation[k] for k in ('source_id', 'source_object_id', 'quote_currency', 'coverage_key'))
                    and indicator_input_valid(row, row['collected_at'], allow_source_only=True)
                    and timestamp(row['collected_at']) <= target
                    and 0 <= (target - stamp).total_seconds() <= PARAMS['volume_baseline_tolerance_minutes'] * 60
                    and all(finite(row[k]) for k in ('current_price', 'market_cap', 'total_volume', 'price_change_percentage_24h'))
                    and row['current_price'] > 0 and row['market_cap'] >= PARAMS['min_market_cap_usd']
                    and row['total_volume'] >= PARAMS['min_baseline_volume_usd']):
                matches.append(row)
        except (KeyError, ValueError, TypeError, OverflowError):
            continue
    return max(matches, key=lambda row: timestamp(row['requested_at']), default=None)


def calculate_indicators(observation, history, at):
    """Reference math for the Polars stage, not a second scorer or runtime engine."""
    if not indicator_input_valid(observation, at, allow_source_only=True):
        return None
    baseline = source_volume_baseline(observation, history) if observation['asset_id'] is None else volume_baseline(observation, history)
    normalized = {**observation}
    for key in ('current_price', 'market_cap', 'total_volume', 'price_change_percentage_24h', 'ath_change_percentage'):
        normalized[key] = observation.get(key) if finite(observation.get(key)) else None
    volume, cap, pct = (normalized[k] for k in ('total_volume', 'market_cap', 'price_change_percentage_24h'))
    return {**normalized, 'metric_version': METRIC_VERSION,
            'metric_id': observation['observation_id'] + '/' + METRIC_VERSION,
            'slot_start': slot_start(observation['requested_at']), 'calculated_at': timestamp(at),
            'volume_to_market_cap': volume / cap if volume is not None and volume >= 0 and cap is not None and cap > 0 else None,
            'abs_price_pct': abs(pct) if pct is not None else None,
            'volume_ratio': volume / baseline['total_volume'] if baseline and volume is not None and volume >= 0 else None,
            'baseline_observation_id': baseline['observation_id'] if baseline else None,
            'baseline_requested_at': baseline['requested_at'] if baseline else None,
            'baseline_volume': baseline['total_volume'] if baseline else None}


def alert_conditions(metrics, at):
    """Reference threshold decisions over published metrics; never calculates ratios."""
    if not metrics or not indicator_input_valid(metrics, at):
        return []
    try:
        if (metrics['metric_version'] != METRIC_VERSION
                or metrics['metric_id'] != metrics['observation_id'] + '/' + METRIC_VERSION
                or not timestamp(metrics['requested_at']) <= timestamp(metrics['calculated_at']) <= timestamp(at)):
            return []
    except (KeyError, ValueError, TypeError):
        return []
    rules = [('price_move_up', 'price_change_percentage_24h', lambda v: v >= 10),
             ('price_move_down', 'price_change_percentage_24h', lambda v: v <= -10),
             ('volume_spike', 'volume_to_market_cap', lambda v: v >= .2),
             ('near_ath', 'ath_change_percentage', lambda v: v >= -5),
             ('deep_from_ath', 'ath_change_percentage', lambda v: v <= -80)]
    return [key for key, field, condition in rules if finite(metrics.get(field)) and condition(metrics[field])]


def valid_indicators(metrics, at):
    """Validate the frozen indicator envelope without recomputing any market metric."""
    if not metrics or not eligible(metrics, at):
        return False
    try:
        ratio = metrics.get('volume_ratio')
        return (metrics['metric_version'] == METRIC_VERSION
                and metrics['metric_id'] == metrics['observation_id'] + '/' + METRIC_VERSION
                and timestamp(metrics['slot_start']) == slot_start(metrics['requested_at'])
                and timestamp(metrics['requested_at']) <= timestamp(metrics['calculated_at']) <= timestamp(at)
                and all(finite(metrics[k]) and metrics[k] >= 0 for k in ('volume_to_market_cap', 'abs_price_pct'))
                and (ratio is None or (finite(ratio) and ratio >= 0
                     and bool(metrics.get('baseline_observation_id'))
                     and metrics.get('baseline_requested_at') is not None
                     and finite(metrics.get('baseline_volume')) and metrics['baseline_volume'] > 0)))
    except (KeyError, ValueError, TypeError, OverflowError):
        return False


def contributions(metrics, at):
    """Score ONLY frozen Polars indicators; no raw-history argument or ratio calculation."""
    if not valid_indicators(metrics, at) or timestamp(metrics['slot_start']) != slot_start(at):
        return []
    fields = {'volume': 'total_volume', 'turnover': 'volume_to_market_cap',
              'price': 'abs_price_pct', 'volume_growth': 'volume_ratio'}
    events = []
    for policy, rule in POLICIES.items():
        key = rule['key']
        points = tier_points(key, metrics.get(fields[key]))
        if points:
            suffix = timestamp(metrics['slot_start']).isoformat()
            events.append({'asset_id': metrics['asset_id'], 'score_key': 'total_heat', 'score_delta': points,
                           'decision_ref': f"market_v1/{metrics['asset_id']}/{key}/{suffix}",
                           'decay_policy_ref': policy, 'half_life_minutes': rule['half_life_minutes'],
                           'evidence_refs_json': {'metric_id': metrics['metric_id'], 'observation_id': metrics['observation_id'],
                                                  'baseline_observation_id': metrics.get('baseline_observation_id')}})
    return events


def rollup(events, at):
    """Project hypothetical Redis records, rejecting duplicate/frozen-event conflicts."""
    at = timestamp(at)
    seen, decisions, result = {}, {}, {}
    for event in events:
        rule = POLICIES.get(event.get('decay_policy_ref'))
        if not rule or event.get('score_key') != 'total_heat':
            continue  # Other source/version/+100 contributions remain on their own chain.
        key, decision, asset = (event.get(k) for k in ('event_key', 'decision_ref', 'asset_id'))
        if not all(isinstance(v, str) and v for v in (key, decision, asset)):
            raise ValueError('Missing event identity')
        frozen = {k: event.get(k) for k in ('asset_id','score_key','score_delta','decision_ref','decay_policy_ref','half_life_minutes','created_at')}
        if key in seen:
            if frozen != seen[key]:
                raise ValueError('Conflicting event_key')
            continue
        if decision in decisions and decisions[decision] != key:
            raise ValueError('Duplicate decision_ref with different event_key')
        points, half_life = event.get('score_delta'), event.get('half_life_minutes')
        allowed_points = [rule['points']] if 'points' in rule else [p for _, p in rule['tiers']]
        if not finite(points) or points not in allowed_points or not finite(half_life) or half_life != rule['half_life_minutes']:
            raise ValueError('Invalid frozen contribution')
        created = timestamp(event['created_at'])
        if created > at:
            raise ValueError('Future score event')
        seen[key], decisions[decision] = frozen, key
        values = result.setdefault(asset, {r['key']: 0.0 for r in POLICIES.values()})
        values[rule['key']] += points * 2 ** (-(at - created).total_seconds() / 60 / half_life)
    for values in result.values():
        values['activity_score'] = math.fsum(values[key] for key in ACTIVITY)
    return result


def boards(indicators, projections, score_history, at):
    """Reference rankings over supplied records; never fetches or awards on read."""
    at = timestamp(at)
    result = {'hot': [], 'warming': []}
    for observation in indicators:
        asset = observation.get('asset_id')
        score = projections.get(asset)
        if not valid_indicators(observation, at) or not score:
            continue
        try:
            if (score['algorithm_version'] != RULES['version'] or score['coverage_key'] != observation['coverage_key']
                    or score['quality_status'] != 'healthy'
                    or not 0 <= (at - timestamp(score['calculated_at'])).total_seconds() <= PARAMS['max_score_age_seconds']
                    or not finite(score['activity_score']) or score['activity_score'] < 0):
                continue
        except (KeyError, ValueError, TypeError):
            continue
        result['hot'].append({'asset_id': asset, 'score': score['activity_score']})
        if observation.get('volume_ratio') is None or observation['volume_ratio'] < PARAMS['warming_min_volume_ratio'] or observation['abs_price_pct'] < PARAMS['warming_min_abs_price_pct']:
            continue
        target = at - timedelta(minutes=PARAMS['warming_score_lookback_minutes'])
        previous = []
        for row in score_history:
            try:
                if (row['asset_id'] == asset and row['coverage_key'] == observation['coverage_key']
                        and row['algorithm_version'] == RULES['version'] and row['quality_status'] == 'healthy'
                        and finite(row['activity_score']) and row['activity_score'] >= 0
                        and 0 <= (target - timestamp(row['calculated_at'])).total_seconds() <= PARAMS['score_history_tolerance_minutes'] * 60):
                    previous.append(row)
            except (KeyError, ValueError, TypeError):
                continue
        old = max(previous, key=lambda r: timestamp(r['calculated_at']), default=None)
        if old and score['activity_score'] > old['activity_score']:
            result['warming'].append({'asset_id': asset, 'score': score['activity_score'] - old['activity_score'],
                                      'price_direction': 'up' if observation['price_change_percentage_24h'] > 0 else 'down'})
    for key, rows in result.items():
        if len({r['asset_id'] for r in rows}) != len(rows):
            raise ValueError('Duplicate current observation for asset')
        result[key] = sorted(rows, key=lambda row: (-row['score'], row['asset_id']))[:PARAMS['top_n']]
    return result
