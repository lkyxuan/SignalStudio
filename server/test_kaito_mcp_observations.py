import unittest

from scripts.build_kaito_mcp_observations import fields_for


class KaitoMcpObservationTests(unittest.TestCase):
    def test_collects_fields_from_every_sampled_row(self):
        samples = [{"sample": {"returned": 2, "results": [
            {"mindshare": 0.02, "rank": 1},
            {"mindshare": 0.01, "username": "second_account"},
        ]}}]
        self.assertEqual(set(fields_for("example", samples)),
                         {"mindshare", "rank", "username"})

    def test_collects_both_ranked_groups(self):
        samples = [{"sample": {"top_gainer": {"change": 0.1},
                               "top_loser": {"rank": 2}}}]
        self.assertEqual(set(fields_for("example", samples)), {"change", "rank"})


if __name__ == "__main__":
    unittest.main()
