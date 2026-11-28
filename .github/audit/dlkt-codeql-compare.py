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


def location_error(reason):
    raise UnresolvedLocation(reason)


def local_uri(uri, allow_empty=False):
    if not isinstance(uri, str) or len(uri) > 4096 or (not uri and not allow_empty):
        location_error('invalid-uri')
    if any(ord(c) < 32 or ord(c) == 127 for c in uri) or '\\' in uri:
        location_error('invalid-uri-characters')
    try:
        parsed = urllib.parse.urlsplit(uri)
        raw = urllib.parse.unquote(parsed.path, errors='strict')
    except (ValueError, UnicodeError):
        location_error('malformed-uri')
    if parsed.scheme not in ('', 'file') or parsed.netloc not in ('', 'localhost') or parsed.query or parsed.fragment:
        location_error('nonlocal-uri')
    if any(ord(c) < 32 or ord(c) == 127 for c in raw) or '\\' in raw or '..' in pathlib.PurePosixPath(raw).parts:
        location_error('unsafe-path')
    if not raw and not allow_empty:
        location_error('empty-path')
    return pathlib.Path(raw)


def artifact_path(loc, run, root, files):
    # The caller binds root to a separately verified exact Git checkout and
    # passes that same directory as CodeQL --source-root. SARIF producers may
    # omit the optional originalUriBaseIds mapping for %SRCROOT%.
    if not isinstance(loc, dict):
        location_error('invalid-artifact-location')
    loc = dict(loc)
    # SARIF uses -1 as the sentinel for an absent artifact index.
    if 'index' in loc and not (type(loc['index']) is int and loc['index'] == -1):
        index = loc['index']
        artifacts = run.get('artifacts', [])
        if type(index) is not int or not isinstance(artifacts, list) or not 0 <= index < len(artifacts):
            location_error('invalid-artifact-index')
        inherited = artifacts[index].get('location', {})
        if not isinstance(inherited, dict):
            location_error('invalid-index-location')
        for key in ('uri', 'uriBaseId'):
            if key in inherited:
                if key in loc and loc[key] != inherited[key]:
                    location_error('conflicting-artifact-index')
                loc.setdefault(key, inherited[key])
    root = root.resolve()
    bases = run.get('originalUriBaseIds', {})
    if not isinstance(bases, dict):
        location_error('invalid-base-map')

    def resolve_base(base_id, seen=()):
        if not isinstance(base_id, str) or not base_id or base_id in seen or len(seen) >= 8:
            location_error('invalid-or-cyclic-base')
        if base_id not in bases:
            if base_id == '%SRCROOT%':
                return root
            location_error('unknown-base')
        base = bases[base_id]
        if not isinstance(base, dict):
            location_error('invalid-base')
        path = local_uri(base.get('uri', ''), allow_empty=True)
        parent = base.get('uriBaseId')
        if parent is not None:
            prefix = resolve_base(parent, (*seen, base_id))
        else:
            prefix = root
        if path.is_absolute():
            if parent is not None:
                location_error('absolute-nested-base')
            resolved = path
        else:
            resolved = prefix / path
        if base_id == '%SRCROOT%' and resolved != root:
            location_error('source-root-mismatch')
        return resolved

    path = local_uri(loc.get('uri'))
    base_id = loc.get('uriBaseId')
    if path.is_absolute():
        if base_id is not None:
            resolve_base(base_id)
        absolute = path
    else:
        absolute = (resolve_base(base_id) if base_id is not None else root) / path
    try:
        relative = absolute.relative_to(root).as_posix()
        if absolute.resolve() != absolute:
            location_error('noncanonical-path')
    except (ValueError, OSError, RuntimeError):
        location_error('outside-source-root')
    if relative not in files:
        location_error('untracked-path')
    return relative, files[relative]


def location_diagnostic(loc, run, reason):
    # Only the encrypted private report receives these bounded diagnostics.
    def small(value):
        return str(value)[:360]
    result = {'reason': small(reason)}
    if isinstance(loc, dict):
        result['uri'] = small(loc.get('uri', ''))
        result['uriBaseId'] = small(loc.get('uriBaseId', ''))
        result['index'] = small(loc.get('index', ''))
        bases = run.get('originalUriBaseIds', {})
        if isinstance(bases, dict):
            result['declaredBaseIds'] = [small(key) for key in list(bases)[:8]]
            base_id = loc.get('uriBaseId')
            chain = []
            seen = set()
            while isinstance(base_id, str) and base_id in bases and base_id not in seen and len(chain) < 8:
                seen.add(base_id)
                base = bases[base_id]
                if not isinstance(base, dict):
                    break
                chain.append({'id': small(base_id), 'uri': small(base.get('uri', '')), 'parent': small(base.get('uriBaseId', ''))})
                base_id = base.get('uriBaseId')
            result['baseChain'] = chain
        index = loc.get('index')
        artifacts = run.get('artifacts', [])
        if type(index) is int and isinstance(artifacts, list) and 0 <= index < len(artifacts):
            result['indexedLocation'] = small(artifacts[index].get('location', {}))
    return result

def finding(result, run, root, files, rules):
    rule_id = result.get('ruleId')
    require(isinstance(rule_id, str) and rule_id in rules)
    level = severity(rules[rule_id])
    points = []
    unresolved = 0
    diagnostics = []

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
                except UnresolvedLocation as error:
                    unresolved += 1
                    if len(diagnostics) < 12:
                        diagnostics.append(location_diagnostic(item, run, error))
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
            'unresolvedLocations': unresolved, 'locations': list({canonical(p): p for p in points}.values())[:64],
            'locationDiagnostics': diagnostics,
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
    # Real CodeQL-style source-root-relative, indexed and chained SARIF locations.
    normal = {'uri': 'source/src/demo.ts', 'uriBaseId': '%SRCROOT%'}
    empty = {'artifacts': []}
    require(artifact_path(normal, empty, root, files) == ('source/src/demo.ts', 'a' * 40))
    indexed = {'artifacts': [{'location': normal}]}
    require(artifact_path({'index': 0}, indexed, root, files) == ('source/src/demo.ts', 'a' * 40))
    require(artifact_path({'index': 0, **normal}, indexed, root, files) == ('source/src/demo.ts', 'a' * 40))
    require(artifact_path({'index': -1, **normal}, indexed, root, files) == ('source/src/demo.ts', 'a' * 40))
    nested = {'originalUriBaseIds': {'PROJECT': {'uri': root.as_uri() + '/'}, 'SUB': {'uri': 'source/', 'uriBaseId': 'PROJECT'}}}
    require(artifact_path({'uri': 'src/demo.ts', 'uriBaseId': 'SUB'}, nested, root, files) == ('source/src/demo.ts', 'a' * 40))
    require(artifact_path({'uri': (root / 'source/src/demo.ts').as_uri()}, empty, root, files) == ('source/src/demo.ts', 'a' * 40))
    require(artifact_path({'uri': 'source/src/demo.ts'}, empty, root, files) == ('source/src/demo.ts', 'a' * 40))
    percent_files = {**files, 'source/src/a b.ts': 'd' * 40}
    require(artifact_path({'uri': 'source/src/a%20b.ts', 'uriBaseId': '%SRCROOT%'}, empty, root, percent_files)[0] == 'source/src/a b.ts')
    implicit = finding(result('source/src/demo.ts'), empty, root, files, rules)
    require(implicit['signature'] == a['signature'])
    rejects = [({'uri': 'source/src/demo.ts', 'uriBaseId': 'UNKNOWN'}, empty),
               ({'uri': 'source/src/%2e%2e/demo.ts'}, empty),
               ({'uri': 'source/src/demo.ts?x=1'}, empty),
               ({'uri': 'file:///outside/source/src/demo.ts'}, empty),
               ({'uri': 'source/src/not-tracked.ts'}, empty),
               ({'uri': 'source/src/demo.ts', 'uriBaseId': 'LOOP'}, {'originalUriBaseIds': {'LOOP': {'uri': 'source/', 'uriBaseId': 'LOOP'}}}),
               ({'index': 0, 'uri': 'source/public/demo.js'}, indexed),
               ({'index': 2}, indexed),
               ({'uri': 'source/src/demo.ts', 'uriBaseId': '%SRCROOT%'}, {'originalUriBaseIds': {'%SRCROOT%': {'uri': 'file:///outside/'}}})]
    for loc, doc in rejects:
        try:
            artifact_path(loc, doc, root, files)
        except UnresolvedLocation:
            continue
        raise ValueError('invalid location was accepted')
    bad = finding(result('source/src/not-tracked.ts'), empty, root, files, rules)
    require(bad['signature'] is None and bad['locationDiagnostics'][0]['reason'] == 'untracked-path')
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
