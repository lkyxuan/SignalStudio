"""Public, read-only summary of the local host updater; never expose raw logs/paths."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re

PHASES = {'current', 'checking', 'validating', 'stopping', 'backing_up', 'updating', 'starting', 'failed', 'paused', 'recovery_required', 'updated', 'applying', 'rolling_back', 'rolled_back'}


def summary(path=None, now=None):
    path = path or Path.home() / 'Library/Application Support/SignalStudio/updater/status.json'
    now = now or datetime.now(timezone.utc)
    if not path.exists():
        return {'phase': 'not-installed', 'stale': True}
    try:
        state = json.loads(path.read_text())
        if not isinstance(state, dict):
            raise ValueError('Invalid state')
        result = {'phase': state.get('phase') if state.get('phase') in PHASES else 'unknown'}
        for key in ('current_commit', 'candidate_commit', 'last_success', 'last_check', 'updated_at'):
            value = state.get(key)
            if key in ('current_commit', 'candidate_commit'):
                if isinstance(value, str) and re.fullmatch('[0-9a-f]{40}', value):
                    result[key] = value
            elif isinstance(value, str):
                datetime.fromisoformat(value.replace('Z', '+00:00'))
                result[key] = value
        checked = result.get('last_check') or result.get('updated_at')
        result['stale'] = not checked or not 0 <= (now - datetime.fromisoformat(checked.replace('Z', '+00:00'))).total_seconds() <= 180
        # Reasons are deliberately mapped to fixed public wording, not redacted raw exceptions.
        result['reason'] = {'paused': '兼容性或工作区检查暂停，请在主机核对更新记录。',
                            'failed': '更新失败，请在主机核对诊断记录。',
                            'recovery_required': '更新中断，需要在主机人工恢复。'}.get(result['phase'], '')
        return result
    except (OSError, ValueError, TypeError):
        return {'phase': 'unknown', 'stale': True, 'reason': '暂时无法确认主机更新状态。'}
