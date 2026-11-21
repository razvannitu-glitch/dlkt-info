import { object, validCity } from './local-contracts.js';
/** One current connection hint. Stored preferences never establish the current location. */
export async function initializeCurrentCity(port) {
    if (!port.maySelect())
        return 'superseded';
    let hint;
    try {
        hint = await port.readHint();
    }
    catch {
        return port.maySelect() ? 'unavailable' : 'superseded';
    }
    // A choice made while the request was pending is authoritative for this visit.
    if (!port.maySelect())
        return 'superseded';
    if (!object(hint) || hint.estimated !== true || !validCity(hint.city))
        return 'unavailable';
    await port.select(hint.city);
    return 'selected';
}
