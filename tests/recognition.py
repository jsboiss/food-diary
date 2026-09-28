"""Exercise real request-building/parsing against a loopback fake Responses API. No credits or real keys."""
import base64
import datetime as dt
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from smoke import png, webp_dimensions, ROOT


class Provider(BaseHTTPRequestHandler):
    mode = 'success'
    calls = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'product': {'product_name': 'Test oats', 'brands': 'Fixture', 'ingredients': [{'text': 'Oats'}], 'ingredients_text': 'Oats'}} if '12345678' in self.path else {}).encode())

    def do_POST(self):
        assert self.path == '/v1/responses'
        assert self.headers['Authorization'] == 'Bearer test-key-only'
        if self.headers.get('Transfer-Encoding') == 'chunked':
            chunks = []
            while True:
                length = int(self.rfile.readline().strip(), 16)
                if length == 0:
                    self.rfile.readline()
                    break
                chunks.append(self.rfile.read(length))
                self.rfile.read(2)
            raw = b''.join(chunks)
        else:
            raw = self.rfile.read(int(self.headers['Content-Length']))
        body = json.loads(raw)
        type(self).calls.append(body)
        mode = type(self).mode
        if mode in ('quota', 'rate'):
            self.send_response(429)
            self.end_headers()
            self.wfile.write(json.dumps({'error': {'code': 'insufficient_quota' if mode == 'quota' else 'rate_limit_exceeded'}}).encode())
            if mode == 'rate':
                type(self).mode = 'success'
            return
        if mode == 'unauthorized':
            self.send_response(401)
            self.end_headers()
            return
        description = {'title': 'Rice and vegetables', 'recognized': mode != 'unknown', 'visibleFoods': ['rice', 'vegetables'],
                       'labelIngredients': ['salt'], 'uncertainties': ['Sauce ingredients are unknown.']}
        content = [{'type': 'output_text', 'text': json.dumps(description) if mode != 'malformed' else '{broken'}]
        if mode == 'refusal':
            content = [{'type': 'refusal', 'refusal': 'Provider text should not be exposed'}]
        response = {'status': 'incomplete' if mode == 'incomplete' else 'completed', 'model': 'gpt-5.6-terra',
                    'output': [{'type': 'message', 'content': content}],
                    'usage': {'input_tokens': 2400, 'output_tokens': 150, 'input_tokens_details': {'cached_tokens': 0}}}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())


def main():
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    with tempfile.TemporaryDirectory(prefix='food-diary-recognition-') as directory, tempfile.TemporaryFile() as log:
        environment = {**os.environ, 'ASPNETCORE_ENVIRONMENT': 'Development', 'ASPNETCORE_URLS': base,
                       'DATA_PATH': directory, 'APP_PASSWORD': 'test-password-only', 'ANALYSIS_MODE': 'openai',
                       'OPENAI_API_KEY': 'test-key-only', 'OPENAI_MODEL': 'gpt-5.6-terra',
                       'ANALYSIS_COMPARE_SOURCE': 'false', 'PRODUCTS_URL': f'http://127.0.0.1:{provider.server_port}/',
                       'OPENAI_RESPONSES_URL': f'http://127.0.0.1:{provider.server_port}/v1/responses'}
        process = subprocess.Popen(['dotnet', str(ROOT / 'bin/Debug/net10.0/FoodDiary.dll')], cwd=ROOT, env=environment, stdout=log, stderr=log)

        def request(path, method='GET', body=None, content_type=None):
            data = json.dumps(body).encode() if isinstance(body, dict) else body
            req = urllib.request.Request(base + path, data=data, method=method,
                headers={'X-Diary-Request': '1', 'Content-Type': content_type or ('application/json' if isinstance(body, dict) else 'application/octet-stream')})
            with client.open(req, timeout=10) as response:
                return response.read()

        def wait(entry_id, predicate):
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                state = json.loads(request('/api/entries'))
                assert state['mode'] == 'openai'
                entry = next(item for item in state['entries'] if item['id'] == entry_id)
                if predicate(entry):
                    return entry
                time.sleep(.15)
            raise AssertionError(f'Timed out waiting for {entry}')

        def upload(mode='success', kind='meal'):
            Provider.mode = mode
            entry_id = str(uuid.uuid4())
            query = urllib.parse.urlencode({'occurredAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'feeling': '', 'zone': 'Australia/Brisbane', 'photoKind': kind})
            request(f'/api/entries/{entry_id}/photo?{query}', 'PUT', png(2400, 1600, 6))
            return entry_id

        try:
            for _ in range(100):
                try:
                    urllib.request.urlopen(base + '/health', timeout=1).close()
                    break
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(.1)
            request('/api/login', 'POST', {'password': 'test-password-only'})
            meal = upload()
            entry = wait(meal, lambda item: item['status'] == 'Identified' and item['originalDeletedAt'])
            assert entry['recognition']['labelIngredients'] == [], 'Meal must not acquire invented label ingredients'
            assert entry['recognition']['inputTokens'] == 2400 and entry['recognition']['outputTokens'] == 150
            assert not (Path(directory) / f'{meal}.original').exists()
            sent = Provider.calls[-1]
            assert sent['store'] is False and sent['reasoning']['effort'] == 'none'
            assert sent['max_output_tokens'] == 1600 and sent['text']['format']['strict'] is True
            image = sent['input'][0]['content'][1]
            assert image['detail'] == 'high'
            image_bytes = base64.b64decode(image['image_url'].split(',')[1])
            assert image_bytes == (Path(directory) / f'{meal}.webp').read_bytes(), 'Meal must use exact preview'
            width, height = webp_dimensions(image_bytes)
            assert width * height <= 2_000_000 and width < height
            label = upload(kind='label')
            entry = wait(label, lambda item: item['status'] == 'Identified' and item['originalDeletedAt'])
            assert entry['recognition']['labelIngredients'] == ['salt']
            image = Provider.calls[-1]['input'][0]['content'][1]
            assert image['detail'] == 'original'
            assert webp_dimensions(base64.b64decode(image['image_url'].split(',')[1])) == (1600, 2400)
            assert entry['width'] * entry['height'] <= 2_000_000
            auto = str(uuid.uuid4())
            boundary = 'food-diary-test-boundary'
            description = 'Homemade bolognese with beef & onion'
            multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n{description}\r\n'
                         f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n').encode() + png(80, 60) + f'\r\n--{boundary}--\r\n'.encode()
            query = urllib.parse.urlencode({'occurredAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'feeling': 'okay', 'zone': 'Australia/Brisbane'})
            request(f'/api/entries/{auto}/photo?{query}', 'PUT', multipart, f'multipart/form-data; boundary={boundary}')
            request(f'/api/entries/{auto}', 'PATCH', {'title': 'My bolognese', 'ingredients': ['beef', 'onion']})
            entry = wait(auto, lambda item: item['status'] == 'Identified' and item['originalDeletedAt'])
            assert entry['photoKind'] == 'auto' and entry['description'] == description
            assert json.loads(Provider.calls[-1]['input'][0]['content'][0]['text'].split('data): ', 1)[1]) == description
            assert entry['recognition']['labelIngredients'] == ['salt'], 'Automatic photos retain actual label transcription'
            assert entry['title'] == 'My bolognese' and entry['editedIngredients'] == ['beef', 'onion'], 'Worker must preserve edits'
            request(f'/api/entries/{auto}', 'PATCH', {'title': 'Bolognese', 'ingredients': []})
            entry = wait(auto, lambda item: item['editedIngredients'] == [])
            assert entry['recognition']['visibleFoods'] == ['rice', 'vegetables'], 'Original AI suggestions remain intact'
            try:
                request(f'/api/entries/{auto}', 'PATCH', {'title': 'x', 'ingredients': ['a' * 301]})
                raise AssertionError('Oversized ingredient accepted')
            except urllib.error.HTTPError as error:
                assert error.code == 400
            persisted = json.loads((Path(directory) / 'entries.json').read_text())[auto]
            assert persisted['EditedIngredients'] == [] and persisted['Description'] == description
            for code in ['12345678', '87654321']:
                product_id = str(uuid.uuid4())
                barcode_part = f'--{boundary}\r\nContent-Disposition: form-data; name="barcode"\r\n\r\n{code}\r\n'.encode()
                before = len(Provider.calls)
                request(f'/api/entries/{product_id}/photo?{query}', 'PUT', barcode_part + multipart, f'multipart/form-data; boundary={boundary}')
                entry = wait(product_id, lambda item: item['status'] == 'Identified' and item['originalDeletedAt'])
                if code == '12345678':
                    assert entry['product']['name'] == 'Test oats' and entry['product']['ingredients'] == ['Oats']
                    assert entry['recognition'] is None and len(Provider.calls) == before
                else:
                    assert entry['product'] is None and entry['recognition'] is not None
            for mode in ['quota', 'unauthorized', 'malformed', 'refusal', 'incomplete']:
                before = len(Provider.calls)
                entry_id = upload(mode)
                entry = wait(entry_id, lambda item: item['status'] == 'Failed')
                assert entry['recognition'] is None and entry['retryCount'] == 0
                assert len(Provider.calls) == before + 1
                assert (Path(directory) / f'{entry_id}.original').exists()
                assert 'Provider text' not in entry['error'] and 'test-key' not in entry['error']
                if mode == 'quota':
                    assert 'credits' in entry['error']
                    Provider.mode = 'success'
                    request(f'/api/entries/{entry_id}/retry', 'POST', b'')
                    wait(entry_id, lambda item: item['status'] == 'Identified')
            entry_id = upload('rate')
            wait(entry_id, lambda item: item['status'] == 'RetryScheduled')
            entry = wait(entry_id, lambda item: item['status'] == 'Identified')
            assert entry['attempts'] == 2
            entry_id = upload('unknown')
            wait(entry_id, lambda item: item['status'] == 'Uncertain' and item['originalDeletedAt'])
            export = request('/api/export').decode('utf-8-sig')
            assert 'user-edited' in export and description in export
            assert 'ai-unconfirmed' in export and 'source-4mp-q95' in export and 'preview-2mp-q80' in export
            print('PASS: compressed preview payload, higher-resolution label payload, structured request/result, usage, safe errors, billing failures, bounded retry scheduling, unknown images, CSV provenance and deletion. No real API calls.')
        finally:
            process.terminate()
            process.wait(timeout=15)
            provider.shutdown()


if __name__ == '__main__':
    main()
