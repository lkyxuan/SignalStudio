"""Conservative per-user updater for the private Mac mini host (SS-31)."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import plistlib
import signal
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

LABEL = 'local.signalstudio.updater'
SERVICE = 'local.signalstudio.server'
DEFAULT_STATE = Path.home() / 'Library/Application Support/SignalStudio/updater'
# Backend/catalog/runtime changes may migrate or rewrite persistent state at startup.
# Unknown paths pause too: compatibility is never inferred from a passing build.
SAFE_FILES = {'index.html', 'package.json', 'package-lock.json', 'tsconfig.json',
              'vite.config.js', 'vite.config.ts', 'README.md', 'README.zh-CN.md',
              '.gitignore', 'AGENTS.md'}
SAFE_DIRS = {'src', 'public', 'docs', 'design'}


class Pause(Exception):
    pass


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(args, cwd=None, timeout=60, env=None):
    """Bound command and all its children; never invoke a shell."""
    process = subprocess.Popen([str(a) for a in args], cwd=cwd, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        output = process.communicate(timeout=timeout)[0].decode(errors='replace')
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise RuntimeError(f'Command timed out: {args[0]}')
    if process.returncode:
        raise RuntimeError(f'{args[0]} exited {process.returncode}: {output[-4000:]}')
    return output.rstrip('\n')


def git(root, *args):
    return run(['git', '-C', root, *args])


def changed_files(root, old, target):
    return git(root, 'diff', '--name-only', '--no-renames', '-z', old, target).split('\0') if old != target else []


def unsafe_files(paths):
    return [p for p in paths if p and p not in SAFE_FILES and p.split('/')[0] not in SAFE_DIRS]


def clean_source(root):
    # Porcelain -z makes spaces and Unicode in filenames unambiguous. Reject renames
    # and any staged change, including a staged DB; only the live unstaged DB is exempt.
    records = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0')
    for entry in records:
        if entry and entry != ' M data/logic.db':
            raise Pause(f'Local source/index changes: {entry}')


def backup_database(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise RuntimeError('Backup destination already exists')
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True, timeout=10) as db:
        with sqlite3.connect(destination) as copy:
            db.backup(copy)
            if copy.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed')
    destination.chmod(0o600)


def read_health(url):
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=2) as response:
        return json.load(response)


class LaunchService:
    def __init__(self, root):
        self.root = root
        self.plist = Path.home() / f'Library/LaunchAgents/{SERVICE}.plist'
        self.config = plistlib.loads(self.plist.read_bytes())
        argv = self.config['ProgramArguments']
        self.host = argv[argv.index('--client-host') + 1]
        self.node = argv[argv.index('--node') + 1]
        self.python = argv[0]
        self.domain = f'gui/{os.getuid()}'
        if self.config['WorkingDirectory'] != str(root):
            raise Pause('Service working directory does not match updater root')
        if Path(argv[1]).resolve() != root / 'scripts/dev_runtime.py':
            raise Pause('Unexpected service entrypoint')

    def stop(self):
        result = subprocess.run(['launchctl', 'bootout', f'{self.domain}/{SERVICE}'], capture_output=True, timeout=30)
        if result.returncode and subprocess.run(['launchctl', 'print', f'{self.domain}/{SERVICE}'], capture_output=True).returncode == 0:
            raise RuntimeError('Could not unload the service')
        # bootout must release every endpoint before source/dependency changes.
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            occupied = False
            for host, port in ((self.host, 15173), ('127.0.0.1', 18788), ('127.0.0.1', 18789)):
                with socket.socket() as probe:
                    probe.settimeout(.5)
                    occupied |= probe.connect_ex((host, port)) == 0
            if not occupied:
                return
            time.sleep(.2)
        raise RuntimeError('Service ports did not close; source was not updated')

    def start(self):
        run(['launchctl', 'bootstrap', self.domain, self.plist], timeout=30)

    def healthy(self):
        expected_revision = git(self.root, 'rev-parse', 'HEAD')
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            try:
                health = read_health(f'http://{self.host}:15173/__signalstudio_health')
                if (health.get('app') == 'SignalStudio' and health.get('client_ready') is True
                    and health.get('project_root') == str(self.root)
                    and health.get('database_path') == str(self.root / 'data/logic.db')
                    and health.get('code_revision') == expected_revision):
                    return
            except (OSError, ValueError):
                pass
            time.sleep(.5)
        raise RuntimeError('Service identity/readiness check failed')


def validate(candidate, service):
    env = dict(os.environ, PATH=str(Path(service.node).parent) + ':' + os.environ.get('PATH', ''),
               CI='1', PYTHONDONTWRITEBYTECODE='1')
    npm = Path(service.node).parent / 'npm'
    run([npm, 'ci', '--no-audit', '--no-fund'], cwd=candidate, env=env, timeout=300)
    run([npm, 'run', 'build'], cwd=candidate, env=env, timeout=180)
    for suite in ('test:contracts', 'test:layout'):
        run([npm, 'run', suite], cwd=candidate, env=env, timeout=120)
    run([service.python, '-m', 'unittest', 'scripts.test_dev_runtime',
         'server.test_desktop_server'], cwd=candidate, env=env, timeout=120)


class Updater:
    def __init__(self, root, state_dir, service_factory=LaunchService, validator=validate):
        self.root, self.directory = Path(root).resolve(), Path(state_dir)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        self.path = self.directory / 'status.json'
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.service_factory, self.validator = service_factory, validator

    def save(self, phase, **fields):
        self.state.update(phase=phase, updated_at=timestamp(), **fields)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(self.path)
        log = self.directory / 'events.log'
        if log.exists() and log.stat().st_size > 1_000_000:
            log.replace(self.directory / 'events.previous.log')
        with log.open('a') as stream:
            stream.write(json.dumps({'time': timestamp(), 'phase': phase, **fields}, ensure_ascii=False) + '\n')
        print(json.dumps(self.state, ensure_ascii=False), flush=True)

    def once(self, retry=False):
        with (self.directory / 'lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return 'busy'
            # Reload after taking the lock; a competing process may have finished.
            self.state = json.loads(self.path.read_text()) if self.path.exists() else {}
            if (self.directory / 'paused').exists():
                self.save('paused', reason='Paused by operator')
                return 'paused'
            if self.state.get('phase') in {'stopping', 'applying', 'starting', 'rolling_back', 'recovery_required'}:
                self.save('recovery_required', reason='Interrupted delivery; inspect journal before manual recovery')
                return 'recovery_required'
            if not retry and time.time() < self.state.get('next_check_epoch', 0):
                return 'backoff'
            try:
                self.save('checking', last_check=timestamp(), reason='', candidate_commit=None)
                if git(self.root, 'branch', '--show-current') != 'main':
                    raise Pause('Only the main branch may be updated')
                clean_source(self.root)
                old = git(self.root, 'rev-parse', 'HEAD')
                env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=10')
                run(['git', '-C', self.root, 'fetch', '--no-tags', 'origin',
                     '+refs/heads/main:refs/remotes/origin/main'], env=env, timeout=45)
                target = git(self.root, 'rev-parse', 'refs/remotes/origin/main')
                self.save('checking', current_commit=old, candidate_commit=target)
                if old == target:
                    self.save('current', failures=0, next_check_epoch=0)
                    return 'current'
                if self.state.get('failed_commit') == target and not retry:
                    self.save('paused', reason='This commit already failed; use retry or wait for a new commit')
                    return 'paused'
                try:
                    git(self.root, 'merge-base', '--is-ancestor', old, target)
                except RuntimeError:
                    raise Pause('Source branch diverged; only fast-forward updates are allowed')
                paths = [p for p in changed_files(self.root, old, target) if p]
                unsafe = unsafe_files(paths)
                if unsafe:
                    raise Pause('Requires manual compatibility review: ' + ', '.join(unsafe))
                service = self.service_factory(self.root)
                self.save('validating')
                with tempfile.TemporaryDirectory(prefix='signalstudio-candidate-') as temporary:
                    candidate = Path(temporary).resolve() / 'source'
                    candidate.mkdir()
                    archive = Path(temporary) / 'source.tar'
                    run(['git', '-C', self.root, 'archive', '--format=tar', '-o', archive, target])
                    with tarfile.open(archive) as bundle:
                        # Tracked repository paths only; reject symlinks that escape extraction.
                        for member in bundle.getmembers():
                            dest = (candidate / member.name).resolve()
                            if not dest.is_relative_to(candidate) or member.issym() or member.islnk():
                                raise Pause('Archive contains unsafe path or link')
                        bundle.extractall(candidate)
                    self.validator(candidate, service)
                    clean_source(self.root)
                    if git(self.root, 'rev-parse', 'HEAD') != old or git(self.root, 'branch', '--show-current') != 'main':
                        raise Pause('HEAD changed during validation')
                    self.deliver(service, candidate, old, target, paths)
                return 'updated'
            except Pause as error:
                self.save('paused', reason=str(error))
                return 'paused'
            except Exception as error:
                # Delivery errors retain recovery_required when rollback itself failed.
                if self.state.get('phase') == 'recovery_required':
                    self.save('recovery_required', reason=str(error))
                else:
                    failures = self.state.get('failures', 0) + 1
                    self.save('failed', reason=str(error), failed_commit=self.state.get('candidate_commit'),
                              failures=failures, next_check_epoch=time.time() + min(3600, 60 * 2 ** min(failures, 6)))
                return 'failed'

    def deliver(self, service, candidate, old, target, paths):
        backup = self.directory / 'backups' / (datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.db')
        deps, saved_deps = self.root / 'node_modules', self.directory / 'previous-dependencies'
        dist, saved_dist = self.root / 'dist', self.directory / 'previous-dist'
        if saved_deps.exists() or saved_dist.exists():
            raise Pause('Previous dependency backup exists; inspect interrupted delivery')
        service.healthy()
        self.save('stopping', previous_commit=old, changed_paths=paths, backup=str(backup))
        stopped, applied, dependencies_swapped, dependencies_saved = False, False, False, False
        dist_swapped, dist_saved = False, False
        try:
            # Bootout can fail after unloading; recovery below always tries to restore service.
            stopped = True
            service.stop()
            clean_source(self.root)
            if git(self.root, 'rev-parse', 'HEAD') != old or git(self.root, 'branch', '--show-current') != 'main':
                raise RuntimeError('HEAD changed before application')
            backup_database(self.root / 'data/logic.db', backup)
            self.save('applying')
            git(self.root, 'merge', '--ff-only', target)
            applied = True
            if deps.exists():
                deps.rename(saved_deps)
                dependencies_saved = True
            (candidate / 'node_modules').rename(deps)
            dependencies_swapped = True
            if dist.exists():
                dist.rename(saved_dist)
                dist_saved = True
            (candidate / 'dist').rename(dist)
            dist_swapped = True
            self.save('starting')
            service.start()
            service.healthy()
            self.save('updated', current_commit=target, last_success=timestamp(), failed_commit=None,
                      failures=0, next_check_epoch=0, reason='')
        except Exception:
            self.save('rolling_back')
            try:
                if dependencies_swapped or applied:
                    service.stop()
                if applied:
                    if git(self.root, 'rev-parse', 'HEAD') != target:
                        raise RuntimeError('Concurrent HEAD change prevents safe rollback')
                    clean_source(self.root)
                    # Restore only the changed code paths. Never touch data or reset the worktree.
                    git(self.root, 'restore', '--source', old, '--staged', '--worktree', '--', *paths)
                    git(self.root, 'update-ref', '-m', 'SignalStudio updater rollback', 'HEAD', old, target)
                if dist_swapped:
                    import shutil
                    shutil.rmtree(dist)
                if dist_saved:
                    saved_dist.rename(dist)
                if dependencies_swapped:
                    import shutil
                    shutil.rmtree(deps)
                if dependencies_saved:
                    saved_deps.rename(deps)
                if stopped:
                    service.start()
                    service.healthy()
                self.save('rolled_back', current_commit=old)
            except Exception as recovery:
                self.save('recovery_required', reason=f'Rollback failed: {recovery}')
                raise RuntimeError(f'Update and rollback failed: {recovery}')
            raise
        else:
            if dependencies_saved:
                import shutil
                shutil.rmtree(saved_deps)
            if dist_saved:
                import shutil
                shutil.rmtree(saved_dist)
            # Keep the latest 10 successful backups. Failed-run backups stay for diagnosis.
            backups = sorted(backup.parent.glob('*.db'))
            for stale in backups[:-10]:
                stale.unlink()


def install(root, directory):
    import shutil
    # Installed control code stays stable while the repository changes underneath it.
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    installed = directory / 'macos_updater.py'
    shutil.copyfile(Path(__file__), installed)
    plist = Path.home() / f'Library/LaunchAgents/{LABEL}.plist'
    plist.parent.mkdir(parents=True, exist_ok=True)
    config = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(installed),
        '--root', str(root), '--state-dir', str(directory), 'once'],
        'WorkingDirectory': str(directory), 'RunAtLoad': True, 'StartInterval': 60,
        'ProcessType': 'Background', 'EnvironmentVariables': {'PYTHONUNBUFFERED': '1',
        'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
        'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}
    plist.write_bytes(plistlib.dumps(config))
    domain = f'gui/{os.getuid()}'
    subprocess.run(['launchctl', 'bootout', f'{domain}/{LABEL}'], capture_output=True)
    run(['launchctl', 'bootstrap', domain, plist])
    print(f'Installed {plist}; status/events in {directory}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--state-dir', type=Path, default=DEFAULT_STATE)
    parser.add_argument('command', choices=['install', 'once', 'status', 'pause', 'resume', 'retry'])
    args = parser.parse_args()
    root, directory = args.root.resolve(), args.state_dir.expanduser().resolve()
    if args.command == 'install':
        install(root, directory)
        return
    updater = Updater(root, directory)
    if args.command == 'status':
        print(json.dumps(updater.state, ensure_ascii=False, indent=2))
    elif args.command == 'pause':
        (directory / 'paused').touch()
        print('Paused; any delivery already in progress is allowed to finish.')
    elif args.command == 'resume':
        (directory / 'paused').unlink(missing_ok=True)
        print('Resumed; failed commits still require retry.')
    else:
        updater.once(retry=args.command == 'retry')


if __name__ == '__main__':
    main()
