"""青空文庫の正規図書カードURLの生成・検証テスト。"""
import importlib.util
import pathlib
import unittest

source = pathlib.Path(__file__).resolve().parents[1] / "tools" / "build_aozora_works.py"
spec = importlib.util.spec_from_file_location("build_aozora_works", source)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class CanonicalCardTests(unittest.TestCase):
    def test_canonical_url_can_differ_from_author_id(self):
        self.assertEqual(
            builder.canonical_card_person_id(
                "001152", "https://www.aozora.gr.jp/cards/000077/card1152.html"
            ), "000077",
        )

    def test_regular_url(self):
        self.assertEqual(
            builder.canonical_card_person_id(
                "000637", "https://www.aozora.gr.jp/cards/000121/card637.html"
            ), "000121",
        )

    def test_invalid_work_id(self):
        with self.assertRaises(ValueError):
            builder.canonical_card_person_id(
                "001152", "https://www.aozora.gr.jp/cards/000077/card47057.html"
            )

    def test_untrusted_url(self):
        with self.assertRaises(ValueError):
            builder.canonical_card_person_id(
                "001152", "https://other.example/cards/000077/card1152.html"
            )

    def test_missing_url(self):
        with self.assertRaises(ValueError):
            builder.canonical_card_person_id("001152", "")


if __name__ == "__main__":
    unittest.main()
