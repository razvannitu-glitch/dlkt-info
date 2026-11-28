"""Read-only CodeQL comparison. Public output is aggregate only."""
import base64
import collections
import gzip
import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys
import urllib.parse

LEVELS = ('critical', 'high', 'medium', 'low', 'unclassified')
SURFACES = ('runtime-source', 'public-assets', 'tests', 'build-release', 'research-qa', 'other')
MAX_REPORT = 128 * 1024


def require(value):
    if not value:
        raise ValueError('invalid audit input')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def tracked(root):
    output = subprocess.check_output(['git', '-C', str(root), 'ls-tree', '-r', '-z', 'HEAD'], stderr=subprocess.DEVNULL)
    files = {}
    for item in output.split(b'\0'):
        if not item:
            continue
        header, name = item.split(b'\t', 1)
        mode, kind, oid = header.decode('ascii').split()
        if kind == 'blob' and mode in ('100644', '100755'):
            files[name.decode('utf-8')] = oid
    return files


def surface(path):
    if path.startswith(('source/tests/', 'tests/')):
        return 'tests'
    if path.startswith(('source/src/', 'source/api/', 'api/')):
        return 'runtime-source'
    if path.startswith('source/public/'):
        return 'public-assets'
    if path.startswith(('lib/', 'source/scripts/', '.github/')) or path == 'bootstrap.mjs':
        return 'build-release'
    if path.startswith('scripts/'):
        return 'research-qa'
    return 'other'


def severity(rule):
    try:
        score = float(rule.get('properties', {}).get('security-severity'))
    except (ValueError, TypeError):
        return 'unclassified'
    if not math.isfinite(score) or not 0 <= score <= 10:
        return 'unclassified'
    return 'critical' if score >= 9 else 'high' if score >= 7 else 'medium' if score >= 4 else 'low'


class UnresolvedLocation(Exception):
    pass


def artifact_path(loc, run, root, files):
    loc = dict(loc)
    if not isinstance(loc.get('uri'), str):
        index = loc.get('index')
        artifacts = run.get('artifacts', [])
        if not isinstance(index, int) or not 0 <= index < len(artifacts):
            raise UnresolvedLocation()
        loc = {**artifacts[index].get('location', {}), **loc}
    uri = loc.get('uri')
    if not isinstance(uri, str):
        raise UnresolvedLocation()
    base_id = loc.get('uriBaseId')
    if base_id:
        base = run.get('originalUriBaseIds', {}).get(base_id)
        if not isinstance(base, dict) or base.get('uriBaseId') or not isinstance(base.get('uri'), str):
            raise UnresolvedLocation()
        uri = urllib.parse.urljoin(base['uri'], uri)
    parsed = urllib.parse.urlsplit(uri)
    if parsed.scheme not in ('', 'file') or parsed.netloc not in ('', 'localhost') or parsed.query or parsed.fragment:
        raise UnresolvedLocation()
    raw = urllib.parse.unquote(parsed.path)
    if not raw or '\\' in raw or '\x00' in raw or '..' in pathlib.PurePosixPath(raw).parts:
        raise UnresolvedLocation()
    path = pathlib.Path(raw)
    try:
        relative = (path if path.is_absolute() else root / path).resolve().relative_to(root).as_posix()
    except (ValueError, OSError):
        raise UnresolvedLocation() from None
    if relative not in files:
        raise UnresolvedLocation()
    return relative, files[relative]


def finding(result, run, root, files, rules):
    rule_id = result.get('ruleId')
    require(isinstance(rule_id, str) and rule_id in rules)
    level = severity(rules[rule_id])
    points = []
    unresolved = 0

    def normalize(value):
        nonlocal unresolved
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if not isinstance(value, dict):
            return value
        output = {}
        for key, item in value.items():
            if key == 'artifactLocation':
                try:
                    relative, oid = artifact_path(item, run, root, files)
                    output[key] = {'path': relative, 'blob': oid}
                    region = value.get('region', {})
                    points.append({'path': relative, **{k: region[k] for k in ('startLine', 'endLine', 'startColumn', 'endColumn') if k in region}})
                except UnresolvedLocation:
                    unresolved += 1
                    output[key] = {'unresolved': True}
            else:
                output[key] = normalize(item)
        return output

    fields = ('message', 'locations', 'relatedLocations', 'codeFlows', 'stacks', 'graphs', 'graphTraversals', 'analysisTarget', 'fixes', 'fingerprints', 'partialFingerprints', 'kind', 'level')
    evidence = {'ruleId': rule_id, 'severity': level, **{key: normalize(result[key]) for key in fields if key in result}}
    require(isinstance(result.get('locations'), list) and bool(result['locations']))
    primary = points[0]['path'] if points else ''
    signature = digest(canonical(evidence)) if points and not unresolved else None
    return {'rule': rule_id, 'severity': level, 'surface': surface(primary), 'signature': signature,
            'unresolvedLocations': unresolved, 'locations': list({canonical(p): p for p in points}.values())[:24],
            'message': str(result.get('message', {}).get('text', ''))[:800]}


def summarize(doc, root, files):
    require(doc.get('version') == '2.1.0' and isinstance(doc.get('runs'), list) and doc['runs'])
    items = []
    rules_seen = set()
    for run in doc['runs']:
        driver = run.get('tool', {}).get('driver', {})
        require('codeql' in driver.get('name', '').lower())
        rules = {rule['id']: rule for rule in driver.get('rules', [])}
        require(bool(rules))
        rules_seen.update(rules)
        for invocation in run.get('invocations', []):
            require(invocation.get('executionSuccessful') is not False)
            require(not any(n.get('level') == 'error' for n in invocation.get('toolExecutionNotifications', [])))
        require(isinstance(run.get('results'), list))
        items.extend(finding(item, run, root, files, rules) for item in run['results'])
    return items, rules_seen


def compare(base, candidate):
    remaining = collections.Counter(x['signature'] for x in base if x['signature'] is not None)
    for item in candidate:
        signature = item['signature']
        if signature is None:
            item['comparison'] = 'unresolved-location'
        elif remaining[signature]:
            item['comparison'] = 'exact-recorded-evidence-match'
            remaining[signature] -= 1
        else:
            item['comparison'] = 'unmatched'
    return collections.Counter(x['comparison'] for x in candidate)


def counters(items, key, values):
    counts = collections.Counter(x[key] for x in items)
    return {name: counts[name] for name in values}


def self_test():
    root = pathlib.Path('/tmp/dlkt-audit-fixture').resolve()
    files = {'source/src/demo.ts': 'a' * 40, 'source/public/demo.js': 'b' * 40}
    rules = {'js/demo': {'properties': {'security-severity': '8.0'}}}
    run = {'originalUriBaseIds': {'%SRCROOT%': {'uri': root.as_uri() + '/'}}, 'artifacts': []}
    def result(path, line=4):
        return {'ruleId': 'js/demo', 'message': {'text': 'fixture'}, 'locations': [{'physicalLocation': {'artifactLocation': {'uri': path, 'uriBaseId': '%SRCROOT%'}, 'region': {'startLine': line}}}]}
    a = finding(result('source/src/demo.ts'), run, root, files, rules)
    b = finding(result('source/src/demo.ts'), run, root, files, rules)
    changed = finding(result('source/src/demo.ts'), run, root, {**files, 'source/src/demo.ts': 'c' * 40}, rules)
    moved = finding(result('source/src/demo.ts', 5), run, root, files, rules)
    escaped = finding(result('https://outside.invalid/demo.ts'), run, root, files, rules)
    require(a['severity'] == 'high' and a['surface'] == 'runtime-source' and a['signature'] == b['signature'])
    require(a['signature'] != changed['signature'] and a['signature'] != moved['signature'] and escaped['signature'] is None)
    counts = compare([a], [b, dict(b), changed, moved, escaped])
    require(counts == {'exact-recorded-evidence-match': 1, 'unmatched': 3, 'unresolved-location': 1})
    print('DLKT_CODEQL_COMPARISON_SELF_TEST_PASS')


def main():
    self_test()
    root = pathlib.Path(sys.argv[1]).resolve()
    workspace = pathlib.Path(sys.argv[2]).resolve()
    certificate = pathlib.Path(sys.argv[3]).resolve()
    require(digest(subprocess.check_output(['openssl', 'x509', '-in', str(certificate), '-outform', 'DER'], stderr=subprocess.DEVNULL)) == 'c5a660069412a6c75b5eeb65b1ec901b1e4dcff815870dfa333b27bba3dcea2e')
    base, br = summarize(json.loads((root / 'baseline.sarif').read_text(encoding='utf-8')), workspace / 'baseline', tracked(workspace / 'baseline'))
    candidate, cr = summarize(json.loads((root / 'candidate.sarif').read_text(encoding='utf-8')), workspace / 'candidate', tracked(workspace / 'candidate'))
    require(br == cr)
    matched = compare(base, candidate)
    report = {'format': 'dlkt-codeql-private-triage-v1', 'baselineSha': '2005ad5cf04f6ea0f04080eeb66a99f6d895b55d', 'candidateSha': '6baed8c3a185231a5aaf56b9683986e6065e9a2e', 'baseline': base, 'candidate': candidate}
    plain = gzip.compress(canonical(report), mtime=0)
    require(len(plain) <= MAX_REPORT)
    sealed = subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-outform', 'DER', str(certificate)], input=plain, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout
    require(0 < len(sealed) <= MAX_REPORT + 4096)
    encoded = base64.b64encode(sealed).decode('ascii')
    chunks = [encoded[i:i+1000] for i in range(0, len(encoded), 1000)]
    aggregate = {'scope': 'strict recorded SARIF evidence and referenced tracked blob equality; not exploitability', 'baselineSha': report['baselineSha'], 'candidateSha': report['candidateSha'], 'baselineTotal': len(base), 'candidateTotal': len(candidate), 'ruleMetadataCount': len(br), 'exactMatches': matched['exact-recorded-evidence-match'], 'candidateUnmatched': matched['unmatched'], 'candidateUnresolvedLocations': matched['unresolved-location'], 'baselineUnmatchedOrUnresolved': len(base)-matched['exact-recorded-evidence-match'], 'candidateSeverity': counters(candidate, 'severity', LEVELS), 'candidateSurfaces': counters(candidate, 'surface', SURFACES), 'rawFindingsUploaded': False, 'releaseApproval': False}
    print('DLKT_CODEQL_DIFFERENTIAL ' + json.dumps(aggregate, separators=(',', ':')))
    print('DLKT_CODEQL_SEALED_BEGIN ' + json.dumps({'bytes': len(sealed), 'sha256': digest(sealed), 'chunks': len(chunks)}, separators=(',', ':')))
    for i, chunk in enumerate(chunks, 1):
        print(f'DLKT_CODEQL_SEALED_CHUNK {i:04d} {chunk}')
    print('DLKT_CODEQL_SEALED_END ' + digest(sealed))
    if candidate:
        print('DLKT_CODEQL_TRIAGE_REQUIRED')
        return 2
    return 0


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--self-test']:
            self_test()
            sys.exit(0)
        require(len(sys.argv) == 4)
        sys.exit(main())
    except Exception:
        print('DLKT_CODEQL_COMPARISON_FAILED', file=sys.stderr)
        sys.exit(1)
