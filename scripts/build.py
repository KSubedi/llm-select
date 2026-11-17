#!/usr/bin/env python3
"""Build browser-specific, store-uploadable extension archives (stdlib only)."""
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FILES = ['background.js', 'content-main.js', 'content.js', 'content.css',
         'options.html', 'options.js', 'LICENSE']


def build(browser):
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    if browser == 'firefox':
        manifest.pop('minimum_chrome_version', None)
        # Firefox reserves Ctrl+Shift+Y for Downloads on Linux.
        manifest['commands']['_execute_action']['suggested_key']['linux'] = 'Alt+Shift+X'
        manifest['background'] = {'scripts': ['background.js']}
        manifest['browser_specific_settings'] = {'gecko': {
            'id': 'llm-select@ksubedi.com',
            'strict_min_version': '142.0',
            'data_collection_permissions': {'required': ['none']},
        }}
    target = ROOT / 'dist' / browser
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for name in FILES:
        shutil.copy2(ROOT / name, target / name)
    shutil.copytree(ROOT / 'icons', target / 'icons')
    archive = ROOT / 'dist' / f'llm-select-{browser}-{manifest["version"]}.zip'
    with ZipFile(archive, 'w', ZIP_DEFLATED) as package:
        for path in sorted(target.rglob('*')):
            if path.is_file():
                package.write(path, path.relative_to(target))
    print(archive)
    return archive


if __name__ == '__main__':
    archives = [build(browser) for browser in ('chrome', 'firefox')]
    (ROOT / 'dist' / 'SHA256SUMS').write_text(''.join(
        f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n'
        for path in archives))
