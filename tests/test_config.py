import unittest
from backend.config import SettingsUpdate


class TestSettingsUpdate(unittest.TestCase):
    def test_valid_types(self):
        data = SettingsUpdate(start_port=9090, ocr_confidence_threshold=0.5, enable_ocr_cache=False)
        self.assertEqual(data.start_port, 9090)
        self.assertEqual(data.ocr_confidence_threshold, 0.5)
        self.assertFalse(data.enable_ocr_cache)

    def test_partial_update(self):
        data = SettingsUpdate(start_port=9090)
        self.assertEqual(data.start_port, 9090)
        self.assertIsNone(data.host)
        self.assertIsNone(data.enable_ocr_cache)

    def test_empty_update(self):
        data = SettingsUpdate()
        self.assertIsNone(data.host)
        self.assertIsNone(data.start_port)

    def test_invalid_int_rejected(self):
        with self.assertRaises(Exception):
            SettingsUpdate(start_port="abc")

    def test_invalid_float_rejected(self):
        with self.assertRaises(Exception):
            SettingsUpdate(ocr_confidence_threshold="not-a-float")

    def test_invalid_bool_rejected(self):
        with self.assertRaises(Exception):
            SettingsUpdate(enable_ocr_cache=[1, 2, 3])

    def test_model_dump_exclude_none(self):
        data = SettingsUpdate(start_port=9090)
        dumped = data.model_dump(exclude_none=True)
        self.assertEqual(dumped, {"start_port": 9090})
