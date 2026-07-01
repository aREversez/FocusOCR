# -*- mode: python ; coding: utf-8 -*-


import site
import os

# Dynamically find site-packages for the current Python interpreter
site_packages = site.getsitepackages()[1]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[(os.path.join(site_packages, 'onnxruntime', 'capi', '*.dll'), 'onnxruntime\\capi')],
    datas=[('frontend', 'frontend'), (os.path.join(site_packages, 'rapidocr_onnxruntime'), 'rapidocr_onnxruntime')],
    hiddenimports=['backend', 'backend.app', 'backend.ocr_engine', 'backend.folder_picker', 'backend.config', 'rapidocr_onnxruntime', 'PIL', 'PIL._tkinter_finder'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'tensorflow', 'transformers', 'scipy', 'sklearn', 'nltk', 'boto3', 'botocore', 'matplotlib', 'openpyxl', 'lxml', 'sqlalchemy', 'opentelemetry', 'numba', 'pyarrow', 'soundfile', 'av', 'emoji', 'grpc', 'jsonschema', 'regex', 'fsspec', 'cryptography', 'bcrypt', 'psycopg_binary'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FocusOCR',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
