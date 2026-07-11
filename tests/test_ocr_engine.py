import sys
import os
import types
import unittest
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


if __name__ == '__main__':
    unittest.main()
