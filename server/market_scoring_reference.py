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
ACTIVITY = [r['key'] for r in RULES['rules'] if r['key'] != 'discovery']


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


def new_eligible(discovery, observation, at):
    try:
        age = (timestamp(at) - timestamp(discovery['first_seen_at'])).total_seconds()
        return (discovery['discovery_status'] == 'new' and discovery['asset_id'] == observation['asset_id']
                and discovery['coverage_key'] == observation['coverage_key']
                and discovery['identity_status'] == 'resolved'
                and 0 <= age <= PARAMS['new_max_age_days'] * 86400)
    except (KeyError, ValueError, TypeError):
        return False


def contributions(observation, history, discovery, at):
    """Proposed events for ONE frozen valid slot, before durable idempotent publish."""
    if not eligible(observation, at) or slot_start(observation['requested_at']) != slot_start(at):
        return []
    baseline = volume_baseline(observation, history)
    metrics = {'volume': observation['total_volume'],
               'turnover': observation['total_volume'] / observation['market_cap'],
               'price': abs(observation['price_change_percentage_24h']),
               'volume_growth': observation['total_volume'] / baseline['total_volume'] if baseline else None}
    events = []
    for policy, rule in POLICIES.items():
        key = rule['key']
        points = (rule['points'] if new_eligible(discovery, observation, at) else 0) if key == 'discovery' else tier_points(key, metrics[key])
        if points:
            suffix = 'once' if key == 'discovery' else slot_start(at).isoformat()
            events.append({'asset_id': observation['asset_id'], 'score_key': 'total_heat', 'score_delta': points,
                           'decision_ref': f"market_v1/{observation['asset_id']}/{key}/{suffix}",
                           'decay_policy_ref': policy, 'half_life_minutes': rule['half_life_minutes']})
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
        values['discovery_score'] = values['discovery']
        values['new_score'] = values['activity_score'] + values['discovery_score']
    return result


def boards(observations, projections, discoveries, observation_history, score_history, at):
    """Reference rankings over supplied records; never fetches or awards on read."""
    at = timestamp(at)
    result = {'hot': [], 'warming': [], 'new': []}
    for observation in observations:
        asset = observation.get('asset_id')
        score = projections.get(asset)
        if not eligible(observation, at) or not score:
            continue
        try:
            if (score['algorithm_version'] != RULES['version'] or score['coverage_key'] != observation['coverage_key']
                    or score['quality_status'] != 'healthy'
                    or not 0 <= (at - timestamp(score['calculated_at'])).total_seconds() <= PARAMS['max_score_age_seconds']
                    or not all(finite(score[k]) and score[k] >= 0 for k in ('activity_score','discovery_score','new_score'))
                    or not math.isclose(score['new_score'], score['activity_score'] + score['discovery_score'])):
                continue
        except (KeyError, ValueError, TypeError):
            continue
        result['hot'].append({'asset_id': asset, 'score': score['activity_score']})
        if new_eligible(discoveries.get(asset, {}), observation, at):
            result['new'].append({'asset_id': asset, 'score': score['new_score']})
        baseline = volume_baseline(observation, observation_history)
        if not baseline or observation['total_volume'] / baseline['total_volume'] < PARAMS['warming_min_volume_ratio'] or abs(observation['price_change_percentage_24h']) < PARAMS['warming_min_abs_price_pct']:
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
