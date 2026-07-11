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

    @patch("subprocess.Popen")
    @patch("backend.app.Path")
    def test_reveal_in_explorer_windows(self, mock_path_cls, mock_popen):
        mock_path = mock_path_cls.return_value
        mock_path.exists.return_value = True
        from backend.app import reveal_in_explorer
        with patch("os.name", "nt"):
            reveal_in_explorer("C:\\Users\\test\\image.jpg")
            mock_popen.assert_called_once()
            args = mock_popen.call_args[0][0]
            self.assertEqual(args[0], "explorer")
            self.assertEqual(args[1], "/select,")

    @patch("subprocess.Popen")
    @patch("backend.app.Path")
    def test_reveal_in_explorer_macos(self, mock_path_cls, mock_popen):
        mock_path = mock_path_cls.return_value
        mock_path.exists.return_value = True
        from backend.app import reveal_in_explorer
        with patch("sys.platform", "darwin"):
            with patch("os.name", "posix"):
                reveal_in_explorer("/Users/test/image.jpg")
                mock_popen.assert_called_once()
                args = mock_popen.call_args[0][0]
                self.assertEqual(args[0], "open")
                self.assertEqual(args[1], "-R")

    @patch("subprocess.Popen")
    @patch("backend.app.Path")
    def test_reveal_in_explorer_linux(self, mock_path_cls, mock_popen):
        mock_path = mock_path_cls.return_value
        mock_path.exists.return_value = True
        from backend.app import reveal_in_explorer
        with patch("sys.platform", "linux"):
            with patch("os.name", "posix"):
                reveal_in_explorer("/home/test/image.jpg")
                mock_popen.assert_called_once()
                args = mock_popen.call_args[0][0]
                self.assertEqual(args[0], "xdg-open")


class TestScanStreamLockLeak(unittest.TestCase):
    """Regression: parameter validation failure must not acquire the scan lock."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        # Don't mock OCREngine entirely — patch only _init_ocr_engine so the
        # real lock logic (try_acquire_scan / _scan_in_progress) is exercised.
        self.init_patcher = patch('backend.ocr_engine.OCREngine._init_ocr_engine')
        self.mock_init = self.init_patcher.start()
        if 'backend.app' in sys.modules:
            del sys.modules['backend.app']

    def tearDown(self):
        self.init_patcher.stop()
        import shutil
        shutil.rmtree(self._tmpdir)
        if 'backend.app' in sys.modules:
            del sys.modules['backend.app']

    def test_invalid_match_logic_does_not_acquire_lock(self):
        """Bad match_logic → 400; _scan_in_progress stays False."""
        from backend.app import scan_stream, ocr_engine
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            scan_stream(
                target_dir=self._tmpdir,
                dest_dir="",
                keywords=["test"],
                match_logic="invalid",
                exclude_keywords=[]
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertFalse(ocr_engine._scan_in_progress)

    def test_empty_keywords_does_not_acquire_lock(self):
        """Empty keywords → 400; _scan_in_progress stays False."""
        from backend.app import scan_stream, ocr_engine
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            scan_stream(
                target_dir=self._tmpdir,
                dest_dir="",
                keywords=[],
                match_logic="any",
                exclude_keywords=[]
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertFalse(ocr_engine._scan_in_progress)

    def test_nonexistent_target_dir_does_not_acquire_lock(self):
        """Missing target dir → 400; _scan_in_progress stays False."""
        from backend.app import scan_stream, ocr_engine
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            scan_stream(
                target_dir=os.path.join(self._tmpdir, "nonexistent"),
                dest_dir="",
                keywords=["test"],
                match_logic="any",
                exclude_keywords=[]
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertFalse(ocr_engine._scan_in_progress)

    def test_overlapping_dirs_does_not_acquire_lock(self):
        """Target == dest → 400; _scan_in_progress stays False."""
        from backend.app import scan_stream, ocr_engine
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            scan_stream(
                target_dir=self._tmpdir,
                dest_dir=self._tmpdir,  # same as target → overlap
                keywords=["test"],
                match_logic="any",
                exclude_keywords=[]
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertFalse(ocr_engine._scan_in_progress)

    def test_valid_request_acquires_lock(self):
        """A fully valid request should acquire the lock."""
        from backend.app import scan_stream, ocr_engine
        result = scan_stream(
            target_dir=self._tmpdir,
            dest_dir="",
            keywords=["test"],
            match_logic="any",
            exclude_keywords=[]
        )
        self.assertTrue(ocr_engine._scan_in_progress)
        ocr_engine.release_scan(ocr_engine._scan_generation)
        self.assertFalse(ocr_engine._scan_in_progress)


if __name__ == '__main__':
    unittest.main()
