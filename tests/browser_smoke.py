"""Real-browser integration tests. Requires Selenium, Firefox, Chromium and Xvfb.
Run with an X11 window manager (for example Openbox) and xdotool.
CI uses: xvfb-run -a sh tests/run-browser-smoke.sh
Override Firefox's path with FIREFOX_BINARY when needed.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'manifest.json').read_text())['version']
PAGE = b'''<!doctype html><html><head><title>LLM Inspector test fixture</title></head><body><h1>Checkout</h1>
<button id="target" data-testid="submit">Create account</button>
<textarea id="paste"></textarea>
<script>
function SubmitButton() {}
function CheckoutForm() {}
document.querySelector('#target').__reactFiber$test = {
 type: 'button', return: {type: SubmitButton,
 _debugSource: {fileName:'/project/src/SubmitButton.jsx',lineNumber:42},
 return: {type:CheckoutForm}}
};
</script></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(PAGE)
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('0.0.0.0', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()


def shortcut(driver):
    if shutil.which('xdotool'):
        windows = subprocess.check_output(['xdotool', 'search', '--onlyvisible', '--name', 'LLM Inspector test fixture'], text=True).splitlines()
        subprocess.run(['xdotool', 'windowactivate', '--sync', windows[-1]], check=True)
        subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+shift+x' if driver.capabilities['browserName'] == 'firefox' else 'ctrl+shift+y'], check=True)
    else:
        ActionChains(driver).key_down(Keys.CONTROL).key_down(Keys.SHIFT).send_keys('y').key_up(Keys.SHIFT).key_up(Keys.ALT).perform()


def inspect(driver, wait, expected_format='xml'):
    shortcut(driver)
    wait.until(lambda d: d.execute_script("return document.body.style.cursor") == 'crosshair')
    target = driver.find_element(By.ID, 'target')
    ActionChains(driver).move_to_element_with_offset(driver.find_element(By.TAG_NAME, 'html'), 200, 200).perform()
    ActionChains(driver).move_to_element(target).perform()
    wait.until(lambda d: d.find_elements(By.CLASS_NAME, 'llm-inspector-preview'))
    preview = driver.find_element(By.CLASS_NAME, 'llm-inspector-preview').text
    assert '<SubmitButton>' in preview, preview
    target.click()
    wait.until(lambda d: d.execute_script("return document.body.style.cursor") == '')
    wait.until(lambda d: 'Copied to clipboard' in d.find_element(By.TAG_NAME, 'html').text)
    field = driver.find_element(By.ID, 'paste')
    field.clear()
    field.send_keys(Keys.CONTROL, 'v')
    wait.until(lambda d: field.get_attribute('value'))
    text = field.get_attribute('value')
    if expected_format == 'xml':
        assert '<CodeReference>' in text, text
        assert 'comp: SubmitButton' in text, text
        assert 'src: src/SubmitButton.jsx:42' in text, text
        assert 'sel: ' + json.dumps('button[data-testid="submit"]') in text, text
    else:
        assert json.loads(text)['comp'] == 'SubmitButton', text
    assert not driver.find_elements(By.CLASS_NAME, 'llm-inspector-highlight')


def run(browser):
    if browser == 'firefox':
        options = webdriver.FirefoxOptions()
        options.binary_location = os.environ.get('FIREFOX_BINARY', shutil.which('firefox') or '/work/firefox/firefox')
        # GeckoDriver requires system access for navigation to extension options.
        driver = webdriver.Firefox(options=options, service=webdriver.FirefoxService(service_args=['--allow-system-access']))
        # Load the page before install: toolbar shortcut must inject into old tabs.
        driver.get(f'http://localhost:{server.server_port}/')
        driver.install_web_extension(str(ROOT / f'dist/llm-select-firefox-{VERSION}.zip'), permanent=False)
    else:
        options = webdriver.ChromeOptions()
        options.binary_location = os.environ.get('CHROME_BINARY', shutil.which('chromium') or shutil.which('google-chrome'))
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument(f'--load-extension={ROOT / "dist/chrome"}')
        driver = webdriver.Chrome(options=options)
        targets = driver.execute_cdp_cmd('Target.getTargets', {})['targetInfos']
        ext = next(t['url'] for t in targets if t['url'].startswith('chrome-extension://')).rsplit('/',1)[0]
        driver.get(ext + '/options.html')
        commands = driver.execute_async_script('chrome.commands.getAll(arguments[0])')
        assert commands[0]['shortcut'] == 'Ctrl+Shift+Y', commands
        driver.get(f'http://localhost:{server.server_port}/')
    try:
        wait = WebDriverWait(driver, 15)
        inspect(driver, wait)
        print(f'{browser}: shortcut, page-world React/source, highlight, copy OK', flush=True)
        shortcut(driver)
        wait.until(lambda d: d.execute_script('return document.body.style.cursor') == 'crosshair')
        driver.find_element(By.TAG_NAME, 'body').send_keys(Keys.ESCAPE)
        wait.until(lambda d: d.execute_script('return document.body.style.cursor') == '')
        driver.refresh()
        inspect(driver, wait)
        print(f'{browser}: Escape and navigation reinjection OK', flush=True)
        if browser == 'chrome':
            targets = driver.execute_cdp_cmd('Target.getTargets', {})['targetInfos']
            extension_url = next(t['url'] for t in targets if t['url'].startswith('chrome-extension://'))
            base = extension_url.rsplit('/', 1)[0]
        else:
            prefs = Path(driver.capabilities['moz:profile'], 'prefs.js').read_text()
            line = next(line for line in prefs.splitlines() if line.startswith('user_pref("extensions.webextensions.uuids"'))
            mapping = json.loads(json.loads(line.split(', ', 1)[1].rsplit(');', 1)[0]))
            base = 'moz-extension://' + mapping['llm-select@ksubedi.com']
        driver.get(base + '/options.html')
        radio = wait.until(lambda d: d.find_element(By.CSS_SELECTOR, 'input[value="json"]'))
        driver.execute_script('arguments[0].click()', radio)
        # Wait for asynchronous settings persistence by reloading the settings page.
        driver.refresh()
        wait.until(lambda d: d.find_element(By.CSS_SELECTOR, 'input[value="json"]').is_selected())
        driver.get(f'http://localhost:{server.server_port}/')
        inspect(driver, wait, 'json')
        print(f'{browser}: settings save/reload and JSON output OK', flush=True)
        # A non-loopback HTTP origin exercises the insecure-context clipboard fallback.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
            route.connect(('8.8.8.8', 80))
            local_ip = route.getsockname()[0]
        driver.get(f'http://{local_ip}:{server.server_port}/')
        assert not driver.execute_script('return window.isSecureContext')
        inspect(driver, wait, 'json')
        print(f'{browser}: HTTP clipboard fallback OK', flush=True)
        print(f'{browser}: PASS ({driver.capabilities["browserVersion"]})', flush=True)
    except Exception:
        driver.save_screenshot(str(ROOT / 'dist' / f'{browser}-failure.png'))
        raise
    finally:
        driver.quit()

try:
    for browser in os.environ.get('TEST_BROWSERS', 'firefox,chrome').split(','):
        run(browser)
finally:
    server.shutdown()
