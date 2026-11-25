/** Public country context only: no profile, GPS permission or persisted city. */
export async function initializeCountryLanguage(fetchImplementation = fetch) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1800);
    let reader;
    try {
        const response = await fetchImplementation('/api/places?hint=1', { credentials: 'omit', cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? ''))
            return;
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/u.test(length) || Number(length) > 16384))
            return;
        reader = response.body?.getReader();
        if (!reader)
            return;
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, body = '';
        for (;;) {
            const part = await reader.read();
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > 16384)
                return;
            body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
        if (controller.signal.aborted)
            return;
        const value = JSON.parse(body);
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            return;
        const hint = value;
        if (hint.estimated === true && typeof hint.countryCode === 'string' && /^[A-Z]{2}$/u.test(hint.countryCode)) {
            document.dispatchEvent(new CustomEvent('dlkt:country-detected', { detail: { countryCode: hint.countryCode, estimated: true } }));
        }
    }
    catch { /* A missing country hint leaves the existing browser/default language usable. */ }
    finally {
        controller.abort();
        if (reader) {
            void reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
        clearTimeout(timer);
    }
}
