import copy
import unittest
from datetime import datetime, timedelta, timezone

from market_scoring_reference import RULES, contributions, rollup, boards, tier_points, slot_start, eligible, calculate_indicators, alert_conditions


class MarketScoringReferenceTest(unittest.TestCase):
    def setUp(self):
        self.at = datetime(2026, 10, 11, 4, 10, tzinfo=timezone.utc)
        self.observation = dict(observation_id='obs-current', asset_id='asset-a', source_object_id='coin-a', identity_status='resolved',
            source_id='coingecko.coins_markets', quote_currency='usd', coverage_key='coverage-v1', quality_status='healthy',
            requested_at=self.at, collected_at=self.at, observed_at=self.at,
            current_price=1, total_volume=50_000_000, market_cap=100_000_000, price_change_percentage_24h=8)
        self.baseline = {**self.observation, 'observation_id':'obs-baseline', 'total_volume':25_000_000,
                         **{k:self.at-timedelta(days=1) for k in ('requested_at','collected_at','observed_at')}}

    def events(self):
        proposed = contributions(calculate_indicators(self.observation, [self.baseline], self.at), self.at)
        return [{**event, 'event_key':f'event-{i}', 'created_at':self.at} for i,event in enumerate(proposed)]

    def test_source_only_metrics_survive_but_cannot_alert_or_score(self):
        unknown={**self.observation,'asset_id':None,'identity_status':'source_only'}
        base={**self.baseline,'asset_id':None,'identity_status':'source_only'}
        wrong={**base,'source_object_id':'other-coin','total_volume':1_000_000}
        result=calculate_indicators(unknown,[wrong,base],self.at)
        self.assertIsNone(result['asset_id'])
        self.assertEqual(result['identity_status'],'source_only')
        self.assertEqual(result['volume_ratio'],2)
        self.assertEqual(result['volume_to_market_cap'],.5)
        self.assertEqual(result['metric_id'],'obs-current/market_indicators_v1')
        self.assertEqual(alert_conditions(result,self.at),[])
        self.assertEqual(contributions(result,self.at),[])
        self.assertIsNone(calculate_indicators(unknown,[wrong],self.at)['volume_ratio'])
        for status in ('lookup_error','conflict','resolved'):
            self.assertIsNone(calculate_indicators({**unknown,'identity_status':status},[base],self.at))

    def test_declared_examples_and_highest_tier_boundaries(self):
        for example in RULES['examples']:
            observation = {**self.observation, 'total_volume':example['volume'], 'market_cap':example['market_cap'],
                           'price_change_percentage_24h':example['price_pct']}
            base = {**self.baseline, 'total_volume':example['baseline_volume']}
            events = contributions(calculate_indicators(observation, [base], self.at), self.at)
            points = {event['decay_policy_ref'].split('/')[1]:event['score_delta'] for event in events}
            self.assertEqual({key:points.get(key,0) for key in example['expected']}, example['expected'])
            self.assertEqual(sum(points.values()), example['total_per_slot'])
        for rule in RULES['rules']:
            for threshold, points in rule['tiers']:
                self.assertEqual(tier_points(rule['key'],threshold),points)
                self.assertLess(tier_points(rule['key'],threshold-1e-6),points)

    def test_source_gaps_quality_identity_currency_and_non_finite(self):
        self.assertNotIn('market_v1/volume_growth', [e['decay_policy_ref'] for e in contributions(calculate_indicators(self.observation, [], self.at), self.at)])
        for changes in ({'identity_status':'conflict'}, {'asset_id':None}, {'quote_currency':'eur'},
                        {'quality_status':'partial'}, {'source_id':'kaito.entities'}, {'total_volume':True},
                        {'current_price':float('nan')}, {'market_cap':float('inf')}, {'current_price':0},
                        {'total_volume':999999}, {'market_cap':9999999}, {'observed_at':self.at+timedelta(seconds=1)},
                        {'observed_at':self.at-timedelta(minutes=15,seconds=1)}):
            self.assertFalse(eligible({**self.observation, **changes},self.at),changes)
        self.assertTrue(eligible({**self.observation,'observed_at':self.at-timedelta(minutes=15)},self.at))

    def test_volume_history_is_causal_same_coverage_and_not_short_window_volume(self):
        for changes in ({'coverage_key':'other'}, {'source_object_id':'other'}, {'total_volume':999999},
                        {'collected_at':self.baseline['collected_at']+timedelta(seconds=1)},
                        {'requested_at':self.baseline['requested_at']+timedelta(seconds=1)},
                        {'requested_at':self.baseline['requested_at']-timedelta(minutes=30,seconds=1)}):
            events = contributions(calculate_indicators(self.observation, [{**self.baseline,**changes}], self.at), self.at)
            self.assertNotIn('market_v1/volume_growth',[e['decay_policy_ref'] for e in events])
        newer = {**self.baseline,'total_volume':100_000_000}
        older = {**self.baseline,'requested_at':self.baseline['requested_at']-timedelta(minutes=10)}
        self.assertNotIn('market_v1/volume_growth',[e['decay_policy_ref'] for e in contributions(calculate_indicators(self.observation, [older,newer], self.at), self.at)])

    def test_slot_retry_deduplicates_but_later_slot_can_contribute(self):
        initial = contributions(calculate_indicators(self.observation, [self.baseline], self.at), self.at)
        self.assertEqual(initial,contributions(calculate_indicators(self.observation, [self.baseline], self.at+timedelta(seconds=45)), self.at+timedelta(seconds=45)))
        self.assertEqual([],contributions(calculate_indicators(self.observation, [self.baseline], self.at+timedelta(minutes=5)), self.at+timedelta(minutes=5)))
        later = {**self.observation, **{k:self.at+timedelta(minutes=5) for k in ('requested_at','collected_at','observed_at')}}
        again = contributions(calculate_indicators(later, [self.baseline], self.at+timedelta(minutes=5)), self.at+timedelta(minutes=5))
        self.assertNotEqual(initial[-1]['decision_ref'],again[-1]['decision_ref'])
        self.assertNotEqual(initial[0]['decision_ref'],again[0]['decision_ref'])
        self.assertEqual(slot_start('2026-10-11T12:14:59+08:00'),self.at)

    def test_scorer_consumes_frozen_indicators_and_rejects_old_or_missing_versions(self):
        from unittest.mock import patch
        metrics = calculate_indicators(self.observation, [self.baseline], self.at)
        # A scorer never queries history or recalculates the Polars ratio.
        metrics['volume_ratio'] = 5
        with patch('market_scoring_reference.volume_baseline', side_effect=AssertionError('scorer read history')):
            events = contributions(metrics, self.at)
        self.assertEqual(next(e['score_delta'] for e in events if e['decay_policy_ref']=='market_v1/volume_growth'), 40)
        self.assertEqual(contributions(self.observation, self.at), [])
        for changes in ({'metric_version':'old_10min'}, {'metric_id':'wrong'}, {'volume_to_market_cap':float('nan')},
                        {'volume_ratio':2, 'baseline_observation_id':None}):
            self.assertEqual(contributions({**metrics, **changes}, self.at), [])

    def test_alerts_consume_metrics_independently_of_board_gates_and_history(self):
        # A small asset and missing history still have useful alert indicators.
        observation = {**self.observation, 'market_cap':100000, 'total_volume':25000,
                       'price_change_percentage_24h':10, 'ath_change_percentage':-5}
        metrics = calculate_indicators(observation, [], self.at)
        self.assertIsNone(metrics['volume_ratio'])
        self.assertEqual(alert_conditions(metrics,self.at), ['price_move_up','volume_spike','near_ath'])
        self.assertEqual(contributions(metrics, self.at), [])
        # Decisions use the published ratio, never redivide raw volume and cap.
        metrics['volume_to_market_cap']=.199999
        metrics['price_change_percentage_24h']=-10
        metrics['ath_change_percentage']=-80
        self.assertEqual(alert_conditions(metrics,self.at), ['price_move_down','deep_from_ath'])
        metrics['metric_version']='old_10min'
        self.assertEqual(alert_conditions(metrics,self.at), [])

    def test_missing_indicators_skip_only_their_conditions(self):
        observation={**self.observation,'price_change_percentage_24h':float('nan'),
                     'market_cap':0,'ath_change_percentage':-90}
        metrics=calculate_indicators(observation,[],self.at)
        self.assertIsNone(metrics['price_change_percentage_24h'])
        self.assertIsNone(metrics['volume_to_market_cap'])
        self.assertEqual(alert_conditions(metrics,self.at), ['deep_from_ath'])
        for ath in (None,True,float('inf')):
            metrics=calculate_indicators({**observation,'ath_change_percentage':ath},[],self.at)
            self.assertIsNone(metrics['ath_change_percentage'])
            self.assertEqual(alert_conditions(metrics,self.at), [])

    def test_decay_deduplication_and_legacy_scores_excluded(self):
        events = self.events()
        legacy = {'score_key':'total_heat','score_delta':100,'decay_policy_ref':'initial_score'}
        result = rollup(events + copy.deepcopy(events) + [legacy],self.at)['asset-a']
        self.assertEqual(result['activity_score'],55)
        self.assertNotIn('new_score', result)
        later = rollup(events,self.at+timedelta(minutes=30))['asset-a']
        self.assertEqual(later['activity_score'],27.5)
        self.assertNotIn('discovery_score', later)
        self.assertEqual(rollup([{'score_key':'total_heat','score_delta':20,'decay_policy_ref':'market_v1/discovery'}],self.at), {})
        for changes, reason in (({'score_delta':10},'Conflicting event_key'),
                                ({'event_key':'second'},'Duplicate decision_ref')):
            with self.assertRaisesRegex(ValueError,reason):rollup(events+[{**events[0],**changes}],self.at)
        for changes in ({'half_life_minutes':0}, {'half_life_minutes':60}, {'score_delta':float('nan')},
                        {'created_at':self.at+timedelta(seconds=1)}, {'created_at':'2026-10-11T04:10:00'}):
            with self.assertRaises(ValueError):rollup([{**events[0],**changes}],self.at)

    def rankings(self, observation=None, projection=None, history=None):
        projection = projection or dict(rollup(self.events(),self.at)['asset-a'],
            calculated_at=self.at, algorithm_version='market_v1', coverage_key='coverage-v1', quality_status='healthy')
        history = history if history is not None else [dict(projection,asset_id='asset-a',activity_score=10,calculated_at=self.at-timedelta(hours=1))]
        return boards([calculate_indicators(row, [self.baseline], self.at) for row in [observation or self.observation]], {'asset-a':projection}, history, self.at)

    def test_retained_boards_use_redis_score_and_saved_history(self):
        result = self.rankings()
        self.assertEqual(result['hot'][0]['score'],55)
        self.assertNotIn('new',result)
        self.assertEqual(result['warming'][0]['score'],45)
        result = self.rankings(observation={**self.observation,'price_change_percentage_24h':-8})
        self.assertEqual(result['warming'][0]['price_direction'],'down')
        self.assertEqual(self.rankings(history=[])['warming'],[])
        for changes in ({'activity_score':55}, {'coverage_key':'different'}, {'algorithm_version':'v2'},
                        {'calculated_at':self.at-timedelta(minutes=59,seconds=59)},
                        {'calculated_at':self.at-timedelta(minutes=70,seconds=1)}):
            previous = dict(asset_id='asset-a',activity_score=10,calculated_at=self.at-timedelta(hours=1),
                            algorithm_version='market_v1',coverage_key='coverage-v1',quality_status='healthy',**{})
            self.assertEqual(self.rankings(history=[{**previous,**changes}])['warming'],[])

    def test_stale_projection_rejected_and_ties_are_stable(self):
        projection = dict(activity_score=1,algorithm_version='market_v1',
                          coverage_key='coverage-v1',quality_status='healthy',calculated_at=self.at)
        for changes in ({'calculated_at':self.at-timedelta(seconds=121)}, {'activity_score':float('nan')},
                        {'quality_status':'partial'}, {'activity_score':-1}):
            self.assertEqual(self.rankings(projection={**projection,**changes})['hot'],[])
        observations = [{**self.observation,'asset_id':f'asset-{i:02d}'} for i in range(25)]
        projections = {o['asset_id']:projection for o in observations}
        result = boards([calculate_indicators(row, [], self.at) for row in list(reversed(observations))], projections, [], self.at)
        self.assertEqual([r['asset_id'] for r in result['hot']],[f'asset-{i:02d}' for i in range(20)])
        with self.assertRaisesRegex(ValueError,'Duplicate current observation'):
            boards([calculate_indicators(row, [], self.at) for row in [observations[0],observations[0]]], projections, [], self.at)


if __name__ == '__main__':
    unittest.main()
