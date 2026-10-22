"""Pure SS-139 contract checks for examples/tests. Not a collector or consumer."""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid5

SPEC = json.loads((Path(__file__).resolve().parent.parent/'catalog/market-collector-routing.v1.json').read_text())


def _at(value):
    if not isinstance(value,str):
        raise ValueError('Missing source timestamp')
    try:
        result=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError as error:
        raise ValueError('Invalid timestamp') from error
    if result.tzinfo is None or result.utcoffset().total_seconds()!=0:
        raise ValueError('Timestamp must be UTC')
    return result


def validate_market_message(message):
    """Fail closed on missing/unknown provenance; preserve optional upstream fields."""
    for field in SPEC['fields']:
        value=message
        for part in field['path'].split('.'):
            if not isinstance(value,dict) or part not in value:
                raise ValueError('Missing '+field['path'])
            value=value[part]
        if value is None and field['nullable']:
            continue
        typ=field['type']
        if typ=='number' and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value)):
            raise ValueError('Invalid number '+field['path'])
        if typ=='string' and (not isinstance(value,str) or not value):
            raise ValueError('Invalid string '+field['path'])
        if typ=='uuid':
            try: UUID(value)
            except (ValueError,TypeError,AttributeError) as error: raise ValueError('Invalid UUID '+field['path']) from error
        if typ=='timestamp': _at(value)
    meta=message['meta']
    producer=next((p for p in SPEC['producers'] if p['name']==meta['collector_id']),None)
    if not producer or (meta['operation_id'],meta['collection_scope'],meta['coverage_key'],meta['quote_currency']) != (
            'coingecko.coins_markets',producer['scope'],producer['coverage_key'],'usd'):
        raise ValueError('Unknown collector/scope/source/currency tuple')
    if meta['quality_status'] not in ('healthy','missing','invalid','conflict'):
        raise ValueError('Unknown quality status')
    if message['collected_at']!=meta['collected_at']:
        raise ValueError('Collection timestamps disagree')
    if not _at(meta['scheduled_at'])<=_at(meta['requested_at'])<=_at(meta['collected_at']):
        raise ValueError('Invalid collection ordering')
    if message['last_updated'] is None:
        if meta['quality_status']=='healthy': raise ValueError('Missing source time cannot be healthy')
    elif _at(message['last_updated'])>_at(meta['collected_at']):
        raise ValueError('Future source time')
    if meta['source_observation_id']!=str(uuid5(UUID(meta['source_run_id']),message['id'])):
        raise ValueError('Observation ID does not match collector run and coin')
    return {field['normalized']:get_value(message,field['path']) for field in SPEC['fields']}


def get_value(message,path):
    for part in path.split('.'):message=message[part]
    return message


def history_key(message):
    validate_market_message(message)
    meta=message['meta']
    return meta['operation_id'],message['id'],meta['quote_currency'],meta['coverage_key']


def semantic_event_key(message,rule_id,rule_version):
    validate_market_message(message)
    source_time=_at(message['last_updated']).astimezone(timezone.utc).isoformat()
    value=['coingecko_quote_rule_v1',message['meta']['operation_id'],message['id'],
           message['meta']['quote_currency'],source_time,rule_id,rule_version]
    return hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()


def quote_fingerprint(message):
    """Compare only shared quote fields; optional unrequested fields are irrelevant."""
    validate_market_message(message)
    values=[None if message[k] is None else float(message[k]) for k in
            ('current_price','market_cap','total_volume','price_change_percentage_24h')]
    return hashlib.sha256(json.dumps(values,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def coverage_ready(message, report, manifest):
    """Reference check of one resolved report + page manifest, not an I/O loader."""
    try:
        validate_market_message(message)
        meta=message['meta']
        expected={'source_id':meta['operation_id'],'collector_id':meta['collector_id'],
                  'run_id':meta['source_run_id'],'round_id':meta['round_id'],'coverage_key':meta['coverage_key']}
        if any(report.get(key)!=value for key,value in expected.items()): return False
        if report.get('status')!='healthy' or report.get('round_status')!='complete': return False
        if not _at(report['requested_at'])<=_at(meta['requested_at'])<=_at(meta['collected_at'])<=_at(report['completed_at']): return False
        if manifest.get('reference')!=report['snapshot_ref'] or manifest.get('conflict_count')!=0: return False
        pages=manifest['pages'];size=manifest['page_size']
        if not isinstance(size,int) or isinstance(size,bool) or not 1<=size<=250 or not pages: return False
        if report['page_count']!=len(pages) or manifest.get('terminal')!='short_page': return False
        ids=set()
        for index,page in enumerate(pages):
            if page['page']!=index+1 or page['http_status']!=200: return False
            if not isinstance(page['ids'],list) or any(not isinstance(coin,str) or not coin for coin in page['ids']): return False
            if (index<len(pages)-1 and len(page['ids'])!=size) or (index==len(pages)-1 and len(page['ids'])>=size): return False
            ids.update(page['ids'])
        return report['record_count']==len(ids)
    except (ValueError,KeyError,TypeError,AttributeError):
        return False
