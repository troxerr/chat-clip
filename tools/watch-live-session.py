#!/usr/bin/env python3
"""Observe one already-running macOS app without changing capture state."""
import argparse
import collections
import json
import os
from pathlib import Path
import shlex
import shutil
import statistics
import subprocess
import time
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def atomic(path, text):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(text)
    temporary.chmod(0o600)
    temporary.replace(path)


def processes():
    result = subprocess.run(
        ['/bin/ps', '-axo', 'pid=,ppid=,%cpu=,rss=,command='],
        capture_output=True, text=True, timeout=5, check=True)
    rows = []
    for line in result.stdout.splitlines():
        pieces = line.strip().split(None, 4)
        if len(pieces) == 5:
            try:
                rows.append(dict(pid=int(pieces[0]), ppid=int(pieces[1]),
                                 cpu=float(pieces[2]), rssKiB=int(pieces[3]),
                                 command=pieces[4]))
            except ValueError:
                pass
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-pid', type=int, required=True)
    parser.add_argument('--app-executable', required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--capture-start', required=True)
    parser.add_argument('--interval', type=float, default=5)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = args.output_dir / 'watcher.lock'
    try:
        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SystemExit('Observer lock exists; inspect it before starting another observer.')
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(str(os.getpid()))
    totals = collections.Counter()
    mature = collections.Counter()
    participant_sum = reaction_sum = message_sum = 0
    max_score = 0
    latest = None
    last_sample_at = None
    gap_max = 0
    offset = 0
    inode = None
    partial = ''
    active = False
    channel = ''
    session_start = args.capture_start
    incidents = collections.Counter()
    recent_incidents = collections.deque(maxlen=30)
    conditions = set()
    recent_events = collections.deque(maxlen=20)
    cpu = collections.deque(maxlen=720)
    resources = dict(checks=0, cpuMax=0, rssMiBMax=0)
    buffer_stats = dict(checks=0, minBytes=None, maxBytes=0, maxAgeSec=0)
    started = now()
    last_report = 0
    seen_app = False
    missing = 0
    status = 'monitoring'

    def incident(key, detail):
        incidents[key] += 1
        entry = dict(at=now(), kind=key, detail=detail)
        recent_incidents.append(entry)
        with (args.output_dir / 'observations.jsonl').open('a') as handle:
            handle.write(json.dumps(entry) + '\n')

    def report(final=False):
        nonlocal last_report
        last_report = time.monotonic()
        summary = dict(status=status, observerStartedAt=started, updatedAt=now(),
                       appPid=args.app_pid, observerPid=os.getpid(), channel=channel,
                       captureStart=session_start, captureActive=active,
                       intervalSec=args.interval, counts=dict(totals),
                       messages=message_sum, participantWindows=participant_sum,
                       reactionWindows=reaction_sum, detector=dict(mature),
                       maxScore=max_score, maxSampleGapSec=gap_max,
                       latestSample=latest, resources=resources, buffer=buffer_stats,
                       currentHealth=sorted(conditions), incidentCounts=dict(incidents),
                       recentIncidents=list(recent_incidents), recentEvents=list(recent_events))
        atomic(args.output_dir / 'status.json', json.dumps(summary, indent=2) + '\n')
        share = 100 * reaction_sum / max(1, participant_sum)
        lines = [
            '# ChatClip — full session observation', '',
            f'Updated: {summary["updatedAt"]}. Status: **{status}**.', '',
            f'Channel: **{channel}**. Capture started: {session_start}. '
            f'Observer checks every {args.interval:g} seconds and stops when the original app process closes. '
            'A capture stop alone does not end observation.', '',
            '| Measure | Observed |', '| --- | --- |',
            f'| Chat samples / messages | {totals["chat-sample"]:,} / {message_sum:,} |',
            f'| Mature windows / activity passes / reaction passes | {mature["windows"]} / {mature["activityPass"]} / {mature["reactionPass"]} |',
            f'| Recognized reactions / participant-windows | {share:.1f}% (configured requirement: 35%) |',
            f'| Clip requests / saved | {totals["clip-requested"]} / {totals["clip-saved"]} |',
            f'| Error / failed / fatal events | {totals["engine-error"]} / {totals["clip-failed"]} / {totals["engine-fatal"]} |',
            f'| Largest observed sample gap | {gap_max:.1f} seconds |',
            f'| Capture process CPU peak / RSS peak | {resources["cpuMax"]:.1f}% / {resources["rssMiBMax"]:.1f} MiB |',
            f'| Process observations | {resources["checks"]} |',
            f'| Buffer checks / peak size | {buffer_stats["checks"]} / {buffer_stats["maxBytes"]/1048576:.1f} MiB |',
            f'| Health alerts currently active | {", ".join(sorted(conditions)) or "None"} |', '',
            '## Findings and improvements', '',
            '1. **Use the monitoring build after capture ends.** The running bundle has no monitoring worker; this workspace already includes one and an asynchronous export sampler. Give the next build a distinct build number; the two bundles currently both say 3.0.0 / build 4.',
            '2. **Audit reaction coverage before lowering thresholds.** Count native Twitch emote tags, provider load failures, and channel-specific reaction coverage. Current matching uses a fixed phrase regex and loaded 7TV names. Activity passes without reaction passes are candidates for human review, not proof of missed highlights.',
            '3. **Keep five-second samples during export.** The running older bundle awaits export inside its sampler. The workspace already removes this await; validate cadence during a real export after switching builds.',
            '4. **Correct the main Capture telemetry.** The UI compares relative activity score with an absolute participant threshold. Show participants/required participants, reactions/required reactions, and activity multiplier separately.',
            '5. **Show media freshness, cooldown and disk space.** A running encoder process alone does not establish video freshness. Add low-space warnings and complete request-to-export-to-reframe-to-upload timing with clip IDs.',
            '6. **Review clip boundaries explicitly.** Use Started Late / Ended Early and missed-moment feedback before changing the current 15-second preroll/postroll.', '',
            '## Initial media checks', '',
            'A completed buffered segment probed as H.264 1920×1080 at 60 fps and AAC 48 kHz stereo. A two-second video/audio decode returned exit 0 with no FFmpeg errors. Audio was present (mean −14.9 dBFS; peak −2.5 dBFS). Initial free space was approximately 15.1 GB. These are spot checks, not proof of every saved clip or upload.', '',
            '## Recorded incidents', '']
        lines += [f'- {e["at"]}: **{e["kind"]}** — {e["detail"]}' for e in recent_incidents] or ['None recorded.']
        lines += ['', '## Recent pipeline events', '']
        lines += [f'- {e["at"]}: {e["event"]}' for e in recent_events] or ['No clip pipeline event yet.']
        lines += ['', 'Observation is read-only for the recorder: no capture settings, credentials, source implementation, or clips are modified. Raw chat text is not collected. Resource values cover the app process and its descendants; CPU can exceed 100% across cores. Sample gaps during an intentionally stopped capture are excluded. The status file retains exact timestamps and aggregate evidence.', '']
        analyst_notes = args.output_dir / 'ANALYSIS.md'
        if analyst_notes.exists():
            lines += ['## Additional analysis', '', analyst_notes.read_text(), '']
        atomic(args.output_dir / 'SESSION_REVIEW.md', '\n'.join(lines))
        print(json.dumps(dict(status=status, at=summary['updatedAt'], samples=totals['chat-sample'],
                              messages=message_sum, saved=totals['clip-saved'], health=sorted(conditions))), flush=True)

    try:
        while True:
            loop_start = time.monotonic()
            try:
                rows = processes()
            except (OSError, subprocess.SubprocessError) as error:
                incident('observer-process-check-failed', type(error).__name__)
                report()
                time.sleep(args.interval)
                continue
            app = next((p for p in rows if p['pid'] == args.app_pid and p['command'] == args.app_executable), None)
            if app:
                seen_app = True
                missing = 0
            else:
                missing += 1
                if not seen_app:
                    status = 'failed-app-not-running'
                    report(True)
                    break
            path = args.state_dir / 'usage.jsonl'
            try:
                stat = path.stat()
                if inode != stat.st_ino or stat.st_size < offset:
                    if inode is not None:
                        rotated = path.with_name('usage.jsonl.1')
                        if rotated.exists() and rotated.stat().st_ino == inode:
                            with rotated.open() as handle:
                                handle.seek(offset)
                                partial += handle.read()
                    inode, offset = stat.st_ino, 0
                with path.open() as handle:
                    handle.seek(offset)
                    partial += handle.read()
                    offset = handle.tell()
                lines = partial.split('\n')
                partial = lines.pop()
                for line in lines:
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if event.get('at', '') < args.capture_start:
                        continue
                    kind = event.get('event', '')
                    totals[kind] += 1
                    detail = event.get('details', {})
                    if kind == 'capture-start':
                        active = True
                        channel = detail.get('channel', '')
                        session_start = event['at']
                        last_sample_at = None
                    elif kind == 'capture-exit':
                        active = False
                        last_sample_at = None
                    elif kind == 'chat-sample':
                        sample_at = datetime.fromisoformat(event['at'].replace('Z', '+00:00')).timestamp()
                        if last_sample_at is not None:
                            gap = sample_at - last_sample_at
                            gap_max = max(gap_max, gap)
                            if gap > 10:
                                incident('sampler-gap', f'{gap:.1f} seconds between chat samples')
                        last_sample_at = sample_at
                        latest = event
                        message_sum += detail.get('messages', 0)
                        participant_sum += detail.get('participants', 0)
                        reaction_sum += detail.get('reactions', 0)
                        max_score = max(max_score, detail.get('score', 0))
                        if detail.get('threshold', 0) > 0:
                            mature['windows'] += 1
                            mature['activityPass'] += detail.get('participants', 0) >= detail['threshold']
                            mature['reactionPass'] += detail.get('reactions', 0) >= detail.get('reactionFloor', 0)
                    if kind.startswith('clip-') or kind in ('capture-start', 'capture-stop', 'capture-exit', 'engine-error', 'engine-fatal'):
                        recent_events.append(dict(at=event.get('at'), event=kind))
                    if kind in ('engine-error', 'engine-fatal', 'clip-failed'):
                        incident(kind, str(detail.get('error') or detail.get('message') or 'See usage log')[:500])
            except OSError as error:
                incident('observer-log-read-failed', type(error).__name__)
            descendants = {args.app_pid}
            for _ in range(12):
                found = {p['pid'] for p in rows if p['ppid'] in descendants}
                if found <= descendants:
                    break
                descendants |= found
            owned = [p for p in rows if p['pid'] in descendants]
            current_cpu = sum(p['cpu'] for p in owned)
            current_rss = sum(p['rssKiB'] for p in owned) / 1024
            resources['checks'] += 1
            resources['cpuMax'] = round(max(resources['cpuMax'], current_cpu), 1)
            resources['rssMiBMax'] = round(max(resources['rssMiBMax'], current_rss), 1)
            cpu.append(current_cpu)
            new_conditions = set()
            if active and last_sample_at and time.time() - last_sample_at > 20:
                new_conditions.add('chat-samples-stale')
            if current_rss > 1536:
                new_conditions.add('capture-memory-over-1.5GiB')
            if len(cpu) >= 12 and statistics.mean(list(cpu)[-12:]) > 150:
                new_conditions.add('sustained-high-cpu')
            if shutil.disk_usage(args.output_dir).free < 5 * 1024**3:
                new_conditions.add('disk-below-5GiB')
            queue = read_json(args.state_dir / 'queue.json', [])
            if isinstance(queue, list) and len(queue) > 0:
                new_conditions.add('upload-retries-pending')
            for process in owned:
                if ' -segment_list ' not in process['command']:
                    continue
                tokens = shlex.split(process['command'])
                manifest = Path(tokens[tokens.index('-segment_list') + 1])
                try:
                    files = list(manifest.parent.glob('*.ts'))
                    if files:
                        size = sum(f.stat().st_size for f in files)
                        age = max(0, time.time() - max(f.stat().st_mtime for f in files))
                        buffer_stats['checks'] += 1
                        buffer_stats['minBytes'] = min(buffer_stats['minBytes'] or size, size)
                        buffer_stats['maxBytes'] = max(buffer_stats['maxBytes'], size)
                        buffer_stats['maxAgeSec'] = round(max(buffer_stats['maxAgeSec'], age), 2)
                        if active and age > 15:
                            new_conditions.add('video-segments-stale')
                except OSError:
                    pass
            for condition in new_conditions - conditions:
                incident(condition, 'Condition became active; no recorder settings changed.')
            for condition in conditions - new_conditions:
                incident('recovered', condition)
            conditions = new_conditions
            if missing >= 2:
                status = 'completed-app-closed'
                active = False
                incident('app-closed', 'Original ChatClip process no longer exists; observer stopped.')
                report(True)
                break
            if time.monotonic() - last_report >= 30:
                report()
            time.sleep(max(0.1, args.interval - (time.monotonic() - loop_start)))
    except BaseException as error:
        status = 'observer-stopped' if isinstance(error, KeyboardInterrupt) else 'observer-error'
        incident(status, type(error).__name__ + ': ' + str(error)[:300])
        report(True)
        raise
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
