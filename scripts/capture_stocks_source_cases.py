# coding: utf-8
"""One bounded, read-only sample per Stocks endpoint; never a scheduled crawler.

No credentials are persisted. Keyless responses only establish this environment's
access at capture time, not plan entitlement or production availability.
"""
import datetime
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def capture(operations, delay=3):
    cases = {}
    limited = False
    for operation in operations:
        key = operation['key']
        params = dict(operation['sample_request'])
        endpoint = operation['endpoint']
        if '{id}' in endpoint:
            endpoint = endpoint.replace('{id}', urllib.parse.quote(params.pop('id'), safe=''))
        url = 'https://api.coingecko.com/api/v3' + endpoint
        query = urllib.parse.urlencode({k: str(v).lower() if isinstance(v, bool) else v for k, v in params.items()})
        if query:
            url += '?' + query
        record = {'url': url, 'request': operation['sample_request'],
                  'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        if limited:
            record.update(status='not_called_rate_limit', note='Earlier HTTP 429; remaining samples were not sent.')
        else:
            try:
                with urllib.request.urlopen(url, timeout=20) as response:
                    raw = response.read()
                    body = json.loads(raw)
                record.update(status='observed', http_status=200, response_sha256=hashlib.sha256(raw).hexdigest())
                if isinstance(body, list):
                    record.update(response_count=len(body), response=body[:3], response_excerpt=len(body)>3)
                else:
                    record.update(response=body, response_excerpt=False)
            except urllib.error.HTTPError as error:
                record.update(status='http_error', http_status=error.code, response=error.read(2000).decode('utf-8', errors='replace'))
                limited = error.code == 429
            except (OSError, ValueError) as error:
                record.update(status='request_failed', note=str(error))
        cases[key] = record
        print(key, record['status'], record.get('http_status', ''), flush=True)
        if not limited:
            time.sleep(delay)
    return {'version': 'coingecko-stocks-observed.v1', 'evidence': 'upstream_api_only_not_crawler_runtime', 'cases': cases}


if __name__ == '__main__':
    operations = json.loads((ROOT/'catalog/coingecko-stocks.v1.json').read_text())['operations']
    result = capture(operations)
    (ROOT/'catalog/coingecko-stocks-observed.v1.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
