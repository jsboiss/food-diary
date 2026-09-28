"""Real HTTP lifecycle tests using synthetic images and an isolated data directory."""
import csv
import datetime as dt
import http.cookiejar
import io
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[1]


def png(width, height, orientation=None):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    row = b'\0' + bytes([90, 130, 70]) * width
    metadata = b''
    if orientation:
        exif = b'II' + struct.pack('<HIH', 42, 8, 1) + struct.pack('<HHIHHI', 0x112, 3, 1, orientation, 0, 0)
        metadata = chunk(b'eXIf', exif)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + metadata + chunk(b'IDAT', zlib.compress(row * height)) + chunk(b'IEND', b'')


def webp_dimensions(data):
    assert data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    cursor = 12
    dimensions = None
    while cursor + 8 <= len(data):
        kind = data[cursor:cursor + 4]
        size = struct.unpack('<I', data[cursor + 4:cursor + 8])[0]
        body = data[cursor + 8:cursor + 8 + size]
        assert kind not in (b'EXIF', b'XMP ', b'ICCP'), kind
        if kind == b'VP8 ':
            assert body[3:6] == b'\x9d\x01\x2a', 'Expected lossy WebP'
            dimensions = tuple(value & 0x3fff for value in struct.unpack('<HH', body[6:10]))
        cursor += 8 + size + size % 2
    assert dimensions, 'No lossy VP8 frame'
    return dimensions


def main():
    dll = ROOT / 'bin/Debug/net10.0/FoodDiary.dll'
    assert dll.exists(), 'Run dotnet build first'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    with tempfile.TemporaryDirectory(prefix='food-diary-test-') as directory:
        data_path = Path(directory)
        environment = {**os.environ, 'ASPNETCORE_ENVIRONMENT': 'Development', 'DATA_PATH': directory,
                       'APP_PASSWORD': 'test-password-only', 'ASPNETCORE_URLS': base, 'ANALYSIS_MODE': 'simulation'}
        process = None
        log = tempfile.TemporaryFile(mode='w+b')

        def start():
            nonlocal process
            process = subprocess.Popen(['dotnet', str(dll)], cwd=ROOT, env=environment, stdout=log, stderr=log)
            for _ in range(100):
                try:
                    urllib.request.urlopen(base + '/health', timeout=1).close()
                    return
                except (urllib.error.URLError, TimeoutError):
                    if process.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(log.read().decode(errors='replace'))
                    time.sleep(.1)
            raise AssertionError('Server did not start')

        def stop():
            nonlocal process
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=15)
            process = None

        def request(path, method='GET', payload=None, content_type='application/json', authenticated=True):
            if isinstance(payload, dict):
                payload = json.dumps(payload).encode()
            req = urllib.request.Request(base + path, data=payload, method=method,
                                         headers={'X-Diary-Request': '1', 'Content-Type': content_type})
            client = opener if authenticated else urllib.request.build_opener()
            try:
                response = client.open(req, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            return response.status, response.read(), response.headers

        def entries():
            status, body, _ = request('/api/entries')
            assert status == 200, status
            return json.loads(body)['entries']

        def wait_for(entry_id, predicate, timeout=25):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                entry = next((item for item in entries() if item['id'] == entry_id), None)
                if entry and predicate(entry):
                    return entry
                time.sleep(.25)
            raise AssertionError(f'Timed out: {entry_id}: {entries()}')

        def upload(image, failure=False):
            entry_id = str(uuid.uuid4())
            query = urllib.parse.urlencode({'occurredAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                                            'zone': '=1+1', 'feeling': '', 'simulateFailure': str(failure).lower()})
            path = f'/api/entries/{entry_id}/photo?{query}'
            before = time.monotonic()
            status, _, _ = request(path, 'PUT', image, 'application/octet-stream')
            assert status == 202, status
            assert time.monotonic() - before < 8, 'Upload waited for simulated analysis'
            return entry_id, path

        try:
            start()
            assert request('/api/entries', authenticated=False)[0] == 401
            assert request('/api/login', 'POST', {'password': 'wrong'})[0] == 401
            assert request('/api/login', 'POST', {'password': 'test-password-only'})[0] == 200
            large = png(2400, 1600, orientation=6)
            entry_id, path = upload(large)
            entry = wait_for(entry_id, lambda item: item['hasPreview'])
            assert entry['status'] == 'Processing'
            assert (data_path / f'{entry_id}.original').exists()
            assert entry['width'] * entry['height'] <= 2_000_000
            assert entry['width'] < entry['height'], 'EXIF portrait rotation was not applied'
            status, preview, headers = request(f'/api/entries/{entry_id}/preview')
            assert status == 200 and headers['Content-Type'] == 'image/webp'
            assert webp_dimensions(preview) == (entry['width'], entry['height'])
            assert request(f'/api/entries/{entry_id}/preview', authenticated=False)[0] == 401
            assert request(path, 'PUT', large, 'application/octet-stream')[0] == 200
            assert len(entries()) == 1, 'Duplicate upload created a duplicate entry'
            symptom_id = str(uuid.uuid4())
            assert request(f'/api/symptoms/{symptom_id}', 'PUT', {'occurredAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'zone': 'Australia/Brisbane', 'feeling': 'bad'})[0] == 200
            stop()
            start()
            # Cookie keys and queued jobs must survive restart.
            wait_for(entry_id, lambda item: item['status'] == 'Simulated' and item['originalDeletedAt'])
            assert not (data_path / f'{entry_id}.original').exists()
            assert request(f'/api/entries/{entry_id}/preview')[0] == 200
            failed_id, _ = upload(png(40, 20), True)
            failed = wait_for(failed_id, lambda item: item['status'] == 'Failed')
            assert failed['width'] == 40 and failed['height'] == 20, 'Small image was upscaled'
            assert (data_path / f'{failed_id}.original').exists()
            # Expire it while stopped; the retry must work with only its preview.
            stop()
            index_path = data_path / 'entries.json'
            index = json.loads(index_path.read_text())
            index[failed_id]['CreatedAt'] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=25)).isoformat()
            index_path.write_text(json.dumps(index))
            start()
            wait_for(failed_id, lambda item: item['originalDeletedAt'])
            assert not (data_path / f'{failed_id}.original').exists()
            assert request(f'/api/entries/{failed_id}/retry', 'POST', b'')[0] == 202
            wait_for(failed_id, lambda item: item['status'] == 'Simulated')
            broken_id, _ = upload(b'not-an-image')
            broken = wait_for(broken_id, lambda item: item['status'] == 'Failed')
            assert not broken['hasPreview'] and broken['error']
            status, exported, _ = request('/api/export')
            assert status == 200
            rows = list(csv.DictReader(io.StringIO(exported.decode('utf-8-sig'))))
            assert len(rows) == 4
            food = next(row for row in rows if row['id'] == entry_id)
            assert food['stomach'] == '' and food['time_zone'] == "'=1+1"
            assert food['identification_source'] == 'simulation-not-food-recognition'
            assert request('/api/logout', 'POST', b'')[0] == 200
            assert request('/api/entries')[0] == 401
            print('PASS: authentication, non-blocking upload, WebP dimensions/metadata/EXIF orientation, no upscaling, duplicate protection, independent symptoms, crash recovery, original deletion, 24h expiry, preview-only retry, invalid-image handling, CSV and logout.')
        finally:
            stop()
            log.close()


if __name__ == '__main__':
    main()
