import json
import os
import sys
import tempfile
import unittest
from pathlib import Path, PureWindowsPath
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.config import SaveResultsPayload


class TestSaveResultsPayload(unittest.TestCase):
    def test_payload_model(self):
        """SaveResultsPayload validates incoming data."""
        p = SaveResultsPayload(matches=[{"filename": "a.jpg"}], metadata={"total_files": 1})
        self.assertEqual(len(p.matches), 1)
        self.assertEqual(p.metadata["total_files"], 1)

        with self.assertRaises(Exception):
            SaveResultsPayload(metadata={})

        with self.assertRaises(Exception):
            SaveResultsPayload(matches="not_a_list")


class TestResultsEndpoints(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self.results_dir = Path(self._tmpdir) / "results"
        self.results_dir.mkdir()

        self.ocr_patcher = patch('backend.ocr_engine.OCREngine')
        self.mock_ocr = self.ocr_patcher.start()

        if 'backend.app' in sys.modules:
            del sys.modules['backend.app']

    def tearDown(self):
        self.ocr_patcher.stop()
        import shutil
        shutil.rmtree(self._tmpdir)

        if 'backend.app' in sys.modules:
            del sys.modules['backend.app']

    def _save_result(self, filename: str, data: dict):
        (self.results_dir / filename).write_text(json.dumps(data), encoding="utf-8")

    def test_get_result_strips_path_components(self):
        """Path traversal via .. is stripped by Path(filename).name."""
        self.assertEqual(Path("safe.json").name, "safe.json")
        self.assertEqual(Path("../secret.txt").name, "secret.txt")
        self.assertEqual(PureWindowsPath("..\\..\\secret.txt").name, "secret.txt")

    def test_get_result_nonexistent_masked_by_safe_name(self):
        from backend.app import RESULTS_DIR
        with patch("backend.app.RESULTS_DIR", self.results_dir):
            from backend.app import get_result
            from fastapi import HTTPException

            with self.assertRaises(HTTPException) as ctx:
                get_result("nonexistent.json")
            self.assertEqual(ctx.exception.status_code, 404)

    def test_get_result_normal(self):
        from backend.app import RESULTS_DIR
        with patch("backend.app.RESULTS_DIR", self.results_dir):
            from backend.app import get_result
            self._save_result("safe.json", {"matches": [], "metadata": {}})
            result = get_result("safe.json")
            self.assertEqual(result, {"matches": [], "metadata": {}})

    def test_list_results_empty_dir(self):
        from backend.app import RESULTS_DIR
        with patch("backend.app.RESULTS_DIR", self.results_dir):
            from backend.app import list_results
            result = list_results()
            self.assertEqual(result, {"results": []})

    def test_list_results_with_files(self):
        from backend.app import RESULTS_DIR
        with patch("backend.app.RESULTS_DIR", self.results_dir):
            from backend.app import list_results
            self._save_result("scan_1.json", {
                "matches": [{"filename": "a.jpg"}],
                "metadata": {"total_files": 10, "matched_files": 3}
            })
            result = list_results()
            self.assertEqual(len(result["results"]), 1)
            self.assertEqual(result["results"][0]["total_files"], 10)
            self.assertEqual(result["results"][0]["matched_files"], 3)

    def test_list_results_metadata_past_8kb(self):
        """Large matches array must not push metadata out of read window."""
        from backend.app import RESULTS_DIR
        with patch("backend.app.RESULTS_DIR", self.results_dir):
            from backend.app import list_results
            many_matches = [{"filename": f"img_{i}.jpg", "path": f"/dir/img_{i}.jpg",
                             "keywords": ["foo"], "snippets": ["bar"], "boxes": []}
                            for i in range(100)]
            self._save_result("big.json", {
                "matches": many_matches,
                "metadata": {"total_files": 200, "matched_files": 50}
            })
            result = list_results()
            self.assertEqual(len(result["results"]), 1)
            self.assertEqual(result["results"][0]["total_files"], 200)
            self.assertEqual(result["results"][0]["matched_files"], 50)


if __name__ == '__main__':
    unittest.main()
