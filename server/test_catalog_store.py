import csv
import json
import tempfile
import unittest
from pathlib import Path

from catalog_store import CatalogStore, DEFAULT_SCHEMA, ROOT
from catalog_guidance import PURPOSES_ZH
from graph_service import GraphError


class CatalogStoreTest(unittest.TestCase):
    def setUp(self):
        self.catalog = CatalogStore()

    def test_full_v2_inventory_is_searchable_and_paged(self):
        meta = self.catalog.meta()
        self.assertEqual((meta["source_count"], meta["spider_count"],
                          meta["operation_count"], meta["entity_count"],
                          meta["field_count"], meta["selectable_field_count"]),
                         (8, 8, 36, 32, 1520, 68))
        self.assertEqual(self.catalog.list_entities(source="coingecko", status="active")["total"], 1)
        first = self.catalog.list_entities(limit=3)
        second = self.catalog.list_entities(limit=3, offset=3)
        self.assertFalse({item["entity_id"] for item in first["items"]} &
                         {item["entity_id"] for item in second["items"]})
        detail = self.catalog.get_entity("kaito-social-spider.kaito_feed_item", limit=10)
        self.assertEqual(len(detail["fields"]), 10)
        self.assertGreater(self.catalog.list_entities(query="mindshare")["total"], 0)

    def test_every_record_type_exposes_its_upstream_and_crawler_basis(self):
        for entity_id in self.catalog.entities:
            detail = self.catalog.get_entity(entity_id, limit=1)
            basis = detail["source_provenance"]
            self.assertTrue(basis["upstream_url"].startswith("https://"))
            self.assertIn("/spider/", basis["crawler_url"])
            self.assertTrue(basis["scope_zh"])
            self.assertTrue(basis["coverage_zh"])
        self.assertIn("outputSchema", self.catalog.get_entity(
            "kaito-social-spider.kaito_entity_account_mindshare")["source_provenance"]["coverage_zh"])
        dex = self.catalog.get_entity("dexscreener.market_snapshot")
        self.assertEqual(dex["dexscreener_upstream_sample"]["pair"]["chainId"], "pulsechain")
        self.assertIn("txns", dex["dexscreener_upstream_sample"]["pair"])
        self.assertIsNone(self.catalog.get_entity("coingecko.market_snapshot")["dexscreener_upstream_sample"])

    def test_all_fields_are_browsable_but_only_reviewed_fields_can_be_used(self):
        all_fields = self.catalog.get_spider("binance-futures", limit=100)
        reviewed = self.catalog.get_spider("binance-futures", visible_only=True, limit=100)
        self.assertEqual((all_fields["field_count"], reviewed["field_count"]), (145, 24))
        one_record_type = self.catalog.get_spider("binance-futures", entity_id="binance-futures.open_interest")
        self.assertTrue(one_record_type["fields"])
        self.assertTrue(all(field["entity_id"] == "binance-futures.open_interest"
                            for field in one_record_type["fields"]))
        self.assertEqual(one_record_type["field_count"], next(item["field_count"]
                         for item in one_record_type["entities"]
                         if item["entity_id"] == "binance-futures.open_interest"))
        candidate = next(field for field in all_fields["fields"] if field["path"] == "data.long_proportion")
        self.assertFalse(candidate["selectable"])
        self.assertIsNone(candidate["safe_example"])
        with self.assertRaisesRegex(GraphError, "not approved"):
            self.catalog.get_field_definition(candidate["id"])
        entity, field = self.catalog.get_field_definition(
            "binance-futures.open_interest_hist.symbol")
        self.assertEqual(entity["record_type"], "open_interest_hist")
        self.assertTrue(field["selectable"])
        self.assertEqual(field["presentation"]["example_status"], "transformed_test_fixture")
        self.assertEqual(field["presentation"]["example_value"], "BTCUSDT")
        self.assertEqual(self.catalog.get_spider("coingecko", visible_only=True)["field_count"], 0)
        self.assertEqual(self.catalog.get_spider("coingecko")["field_count"], 3)

    def test_invalid_snapshot_and_unknown_queries_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.json"
            invalid = dict(self.catalog.snapshot)
            invalid["source_revision"] = "not-a-revision"
            path.write_text(json.dumps(invalid), encoding="utf-8")
            with self.assertRaises(GraphError):
                CatalogStore(path, DEFAULT_SCHEMA)
        with self.assertRaises(GraphError):
            self.catalog.list_entities(source="missing")
        with self.assertRaises(GraphError):
            self.catalog.get_spider("missing")
        with self.assertRaises(GraphError):
            self.catalog.get_spider("coingecko", entity_id="binance-futures.open_interest")
        with self.assertRaises(GraphError):
            self.catalog.get_entity("missing")

    def test_graph_presentation_uses_only_v2_metadata(self):
        graph = {"nodes": [{"name": "kaito-social-spider.kaito_feed_item",
                            "is_catalog_source": 1}],
                 "fields": [{"catalog_field_id": "taoli.funding_rate.exchange"}]}
        self.catalog.present_graph(graph)
        field = graph["fields"][0]
        self.assertEqual(field["catalog_status"], "current")
        self.assertTrue(field["catalog_selectable"])
        self.assertEqual(field["presentation"]["example"], '"EXAMPLE_EXCHANGE"')
        self.assertEqual(graph["nodes"][0]["catalog_record_label_cn"], "社交动态")

    def test_chinese_display_labels_cover_snapshot_and_are_searchable(self):
        self.assertEqual(set(self.catalog.record_labels_cn), set(self.catalog.entities))
        self.assertEqual(set(self.catalog.field_labels_cn),
                         {field["path"] for field in self.catalog.fields.values()})
        fields = self.catalog.get_spider("kaito-social-spider", query="互动量", limit=100)
        self.assertGreater(fields["total"], 0)
        self.assertTrue(any(field["display_label_cn"] == "互动量" for field in fields["fields"]))
        self.assertEqual(self.catalog.list_entities(query="社交动态")["total"], 1)

    def test_kaito_generic_metrics_are_not_an_operation_field_count(self):
        kaito = self.catalog.list_entities(source="kaito")["items"]
        self.assertEqual(len(kaito), 18)
        self.assertEqual(sum(len(item["operation_names"]) for item in kaito), 19)
        search = next(item for item in kaito if item["record_type"] == "kaito_search_result")
        self.assertEqual(set(search["operation_names"]),
                         {"kaito_search", "kaito_advanced_search"})
        self.assertTrue(all(item["field_count"] == 73 and
                            item["unscoped_conditional_count"] == 33 for item in kaito))
        self.assertEqual(self.catalog.get_spider("kaito-social-spider", entity_id=
            "kaito-social-spider.kaito_feed_item")["unscoped_conditional_count"], 33)
        scoped = self.catalog.get_spider("kaito-social-spider", entity_id=
            "kaito-social-spider.kaito_feed_item", include_unscoped=False, limit=100)
        self.assertEqual((scoped["field_count"], scoped["declared_field_count"]), (40, 73))
        self.assertFalse(any(field["condition"] == "metric present in tool row"
                             for field in scoped["fields"]))
        self.assertEqual(self.catalog.list_spiders()["items"][0]["unscoped_conditional_count"], 0)

    def test_kaito_live_mcp_fields_are_scoped_to_tool_and_sample(self):
        self.assertEqual(len(self.catalog.kaito_mcp_tools), 21)
        feed_id = "kaito-social-spider.kaito_feed_item"
        feed = self.catalog.get_spider("kaito-social-spider", entity_id=feed_id)
        self.assertEqual(feed["mcp_observed"]["tools"][0]["name"], "kaito_feeds")
        self.assertEqual(feed["mcp_observed"]["tools"][0]["observed_field_count"], 12)
        self.assertEqual(next(item for item in feed["entities"] if item["entity_id"] == feed_id)
                         ["observed_upstream_field_count"], 12)
        market_id = "kaito-social-spider.kaito_smart_following_market"
        market = self.catalog.get_spider("kaito-social-spider", entity_id=market_id)
        self.assertEqual(next(item for item in market["entities"] if item["entity_id"] == market_id)
                         ["observed_upstream_field_count"], 16)
        self.assertEqual({tool["name"] for tool in self.catalog.kaito_mcp_tools
                          if tool["entity_id"] is None},
                         {"kaito_market_sentiment", "kaito_ict_impressions"})
        self.assertTrue(all(field["label_zh"] and field["purpose_zh"] and field["use_case_zh"]
                            for tool in self.catalog.kaito_mcp_tools for field in tool["fields"]))

    def test_open_coingecko_response_count_uses_saved_sample_keys(self):
        entity_id = "coingecko.market_snapshot"
        listed = self.catalog.list_entities(source="coingecko")["items"][0]
        detail = self.catalog.get_entity(entity_id)
        self.assertEqual(listed["observed_upstream_field_count"], 26)
        self.assertEqual(detail["entity"]["observed_upstream_field_count"], 26)
        self.assertEqual(detail["field_count"], 3)

    def test_bilingual_table_matches_the_display_catalog(self):
        rows = self.catalog.translation_rows()
        self.assertEqual(len(rows), 1552)
        self.assertEqual(len({row["api_id"] for row in rows}), len(rows))
        self.assertTrue(all(row["display_zh"] for row in rows))
        self.assertEqual(set(PURPOSES_ZH), {field["path"] for field in self.catalog.fields.values()})
        self.assertTrue(all(row["purpose_zh"] and row["use_case_zh"] for row in rows))
        self.assertEqual(sum(row["label_source"] == "v2" for row in rows), 68)
        actual = next(row for row in rows if row["api_id"] ==
                      "binance-futures.open_interest.data.open_interest")
        self.assertEqual(actual["example_value"], "94796.925")
        self.assertEqual(actual["example_status"], "upstream_api")
        self.assertTrue(actual["example_url"].startswith("https://fapi.binance.com/"))
        search = self.catalog.get_spider("kaito-social-spider", entity_id=
            "kaito-social-spider.kaito_search_result", limit=1)
        self.assertEqual(search["record_examples"]["kaito-social-spider.kaito_search_result"]
                         ["status"], "transformed_test_fixture")
        self.assertEqual(self.catalog.get_entity("tg-spider.telegram_message")
                         ["record_example"], None)
        unavailable = next(row for row in rows if row["api_id"] ==
                           "binance-futures.global_long_short_account_ratio.data.long_proportion")
        self.assertEqual((unavailable["example_value"], unavailable["example_status"]),
                         ("0.9613", "transformed_test_fixture"))
        synthetic = next(row for row in rows if row["api_id"] ==
                         "binance-futures.open_interest.symbol")
        self.assertEqual((synthetic["example_value"], synthetic["example_status"]),
                         ("BTCUSDT", "upstream_api"))
        csv_path = ROOT / "catalog" / "catalog-translations.zh.csv"
        self.assertEqual(csv_path.read_text(encoding="utf-8"),
                         self.catalog.translation_csv())
        with csv_path.open(encoding="utf-8", newline="") as source:
            exported = list(csv.DictReader(source))
        self.assertEqual([row["api_id"] for row in exported],
                         [row["api_id"] for row in rows])
        self.assertEqual([row["display_zh"] for row in exported],
                         [row["display_zh"] for row in rows])
        self.assertEqual(next(row["example_value"] for row in exported if row["api_id"] ==
                              "binance-futures.open_interest.data.open_interest"), "94796.925")
        self.assertEqual(self.catalog.list_translations(kind="record_type")["total"], 32)
        self.assertEqual(self.catalog.list_translations(kind="field")["total"], 1520)
        self.assertEqual(self.catalog.list_translations(query="社交动态")["total"], 74)
