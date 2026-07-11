import sys
import os
import types
import unittest
import threading
import time
from pathlib import Path

# Provide minimal PIL stub so tests can run in environments where Pillow is not installed.
if 'PIL' not in sys.modules:
    pil = types.ModuleType('PIL')
    pil_image = types.ModuleType('PIL.Image')
    pil_image.open = lambda *args, **kwargs: None
    pil.Image = pil_image
    sys.modules['PIL'] = pil
    sys.modules['PIL.Image'] = pil_image

import backend.ocr_engine as ocr_engine


class TestOCREngine(unittest.TestCase):
    def test_sanitize_folder_name_removes_invalid_chars(self):
        self.assertEqual(ocr_engine.sanitize_folder_name('inva|id:/name*?"<>'), 'invaidname')
        self.assertEqual(ocr_engine.sanitize_folder_name('\A\B'), '_A_B')
        self.assertEqual(ocr_engine.sanitize_folder_name('   '), 'unnamed_keyword')

    def test_match_keywords_plain_any(self):
        text = 'Hello world\nThis is a test document.'
        matched, snippets, kws = ocr_engine.OCREngine.match_keywords(
            full_text=text,
            keywords=['hello', 'test'],
            match_logic='any',
            use_regex=False,
            exclude_keywords=None,
        )
        self.assertTrue(matched)
        self.assertEqual(set(kws), {'hello', 'test'})
        self.assertIn('Hello world', snippets)

    def test_match_keywords_plain_all(self):
        text = 'One two three\nFour five six'
        matched, snippets, kws = ocr_engine.OCREngine.match_keywords(
            full_text=text,
            keywords=['one', 'six'],
            match_logic='all',
            use_regex=False,
            exclude_keywords=None,
        )
        self.assertTrue(matched)
        self.assertEqual(set(kws), {'one', 'six'})
        self.assertEqual(len(snippets), 2)

    def test_match_keywords_regex(self):
        text = 'Invoice 12345\nAmount: $99.99'
        matched, snippets, kws = ocr_engine.OCREngine.match_keywords(
            full_text=text,
            keywords=[r'Invoice\s+\d+'],
            match_logic='any',
            use_regex=True,
            exclude_keywords=None,
        )
        self.assertTrue(matched)
        self.assertEqual(kws, [r'Invoice\s+\d+'])
        self.assertIn('Invoice 12345', snippets)

    def test_match_keywords_excludes(self):
        text = 'Sensitive data\nPublic data'
        matched, snippets, kws = ocr_engine.OCREngine.match_keywords(
            full_text=text,
            keywords=['data'],
            match_logic='any',
            use_regex=False,
            exclude_keywords=['sensitive'],
        )
        self.assertFalse(matched)
        self.assertEqual(snippets, [])
        self.assertEqual(kws, [])

    def test_match_keywords_invalid_regex_raises(self):
        with self.assertRaises(ValueError):
            ocr_engine.OCREngine.match_keywords(
                full_text='test',
                keywords=['('],
                match_logic='any',
                use_regex=True,
                exclude_keywords=None,
            )

    def test_content_hash_same_file(self):
        """Two references to the same file should produce the same hash."""
        import tempfile, hashlib
        with tempfile.NamedTemporaryFile(delete=False, suffix='.txt') as f:
            f.write(b'hello world ' * 10000)
            p = f.name
        try:
            h1 = ocr_engine.OCREngine._content_hash(Path(p))
            h2 = ocr_engine.OCREngine._content_hash(Path(p))
            self.assertEqual(h1, h2)
        finally:
            os.unlink(p)

    def test_content_hash_different_files(self):
        """Different content should produce different hashes."""
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix='.txt') as f:
            f.write(b'AAA ' * 10000)
            p1 = f.name
        with tempfile.NamedTemporaryFile(delete=False, suffix='.txt') as f:
            f.write(b'BBB ' * 10000)
            p2 = f.name
        try:
            h1 = ocr_engine.OCREngine._content_hash(Path(p1))
            h2 = ocr_engine.OCREngine._content_hash(Path(p2))
            self.assertNotEqual(h1, h2)
        finally:
            os.unlink(p1)
            os.unlink(p2)

    def test_match_keywords_lower_precomputed(self):
        """Precomputed lowercase optimization should match case-insensitively."""
        text = 'UPPERCASE\nlowercase'
        matched, snippets, kws = ocr_engine.OCREngine.match_keywords(
            full_text=text,
            keywords=['uppercase', 'LOWERCASE'],
            match_logic='all',
        )
        self.assertTrue(matched)
        self.assertEqual(len(kws), 2)


class TestCopyFileResolveConflict(unittest.TestCase):
    def setUp(self):
        import tempfile
        self._tmpdir = tempfile.mkdtemp()
        self.src_dir = Path(self._tmpdir) / "src"
        self.dst_dir = Path(self._tmpdir) / "dst"
        self.src_dir.mkdir()

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir)

    def _make_src(self, content: bytes, name: str = "photo.jpg") -> Path:
        p = self.src_dir / name
        p.write_bytes(content)
        return p

    def test_no_conflict_copies_file(self):
        engine = ocr_engine.OCREngine.__new__(ocr_engine.OCREngine)
        engine._cancel_event = None  # not needed
        src = self._make_src(b"unique content")
        dst, dup = engine.copy_file_resolve_conflict(src, self.dst_dir)
        self.assertTrue(dst.exists())
        self.assertFalse(dup)
        self.assertEqual(dst.read_bytes(), b"unique content")
        self.assertEqual(dst.name, "photo.jpg")

    def test_duplicate_same_name_same_content(self):
        engine = ocr_engine.OCREngine.__new__(ocr_engine.OCREngine)
        engine._cancel_event = None
        src = self._make_src(b"same content")
        self.dst_dir.mkdir(parents=True, exist_ok=True)
        (self.dst_dir / "photo.jpg").write_bytes(b"same content")
        dst, dup = engine.copy_file_resolve_conflict(src, self.dst_dir)
        self.assertTrue(dup)
        self.assertEqual(dst.name, "photo.jpg")

    def test_duplicate_numbered_variant(self):
        engine = ocr_engine.OCREngine.__new__(ocr_engine.OCREngine)
        engine._cancel_event = None
        src = self._make_src(b"numbered duplicate")
        self.dst_dir.mkdir(parents=True, exist_ok=True)
        (self.dst_dir / "photo.jpg").write_bytes(b"different content")
        (self.dst_dir / "photo_1.jpg").write_bytes(b"numbered duplicate")
        dst, dup = engine.copy_file_resolve_conflict(src, self.dst_dir)
        self.assertTrue(dup)
        self.assertEqual(dst.name, "photo_1.jpg")

    def test_no_duplicate_creates_numbered_variant(self):
        engine = ocr_engine.OCREngine.__new__(ocr_engine.OCREngine)
        engine._cancel_event = None
        src = self._make_src(b"new version")
        self.dst_dir.mkdir(parents=True, exist_ok=True)
        (self.dst_dir / "photo.jpg").write_bytes(b"old version")
        (self.dst_dir / "photo_1.jpg").write_bytes(b"other version")
        dst, dup = engine.copy_file_resolve_conflict(src, self.dst_dir)
        self.assertFalse(dup)
        self.assertEqual(dst.name, "photo_2.jpg")
        self.assertEqual(dst.read_bytes(), b"new version")


class TestScanLock(unittest.TestCase):
    def setUp(self):
        self.engine = ocr_engine.OCREngine.__new__(ocr_engine.OCREngine)
        self.engine._scan_lock = threading.Lock()
        self.engine._scan_in_progress = False
        self.engine._scan_lock_generation = 0
        self.engine._scan_generation = 0
        self.engine._scan_lock_acquired_at = 0.0
        self.engine._scan_heartbeat_time = 0.0

    def test_acquire_release(self):
        self.assertTrue(self.engine.try_acquire_scan())
        gen = self.engine._scan_generation
        self.engine.release_scan(gen)
        self.assertTrue(self.engine.try_acquire_scan())

    def test_double_acquire_returns_false(self):
        self.assertTrue(self.engine.try_acquire_scan())
        gen1 = self.engine._scan_generation
        self.assertFalse(self.engine.try_acquire_scan())
        self.engine.release_scan(gen1)
        self.assertTrue(self.engine.try_acquire_scan())

    def test_stale_lock_reclaimed(self):
        self.assertTrue(self.engine.try_acquire_scan())
        gen1 = self.engine._scan_generation
        # Simulate stale heartbeat
        self.engine._scan_heartbeat_time = time.time() - ocr_engine.OCREngine.SCAN_LOCK_TIMEOUT - 10
        # Should reclaim (bumps generation)
        self.assertTrue(self.engine.try_acquire_scan())
        gen2 = self.engine._scan_generation
        self.assertNotEqual(gen1, gen2)
        # Old gen release should be ignored
        self.engine.release_scan(gen1)
        # Lock should still be held (gen2 is current)
        self.assertFalse(self.engine.try_acquire_scan())
        # Proper release with current gen
        self.engine.release_scan(gen2)
        self.assertTrue(self.engine.try_acquire_scan())


if __name__ == '__main__':
    unittest.main()
