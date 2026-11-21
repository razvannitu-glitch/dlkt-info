import { createHash } from 'node:crypto';

const canonicalValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('OPERATIONAL_CANONICAL_NUMBER_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    const entries = Object.keys(record).sort().map((key) => {
      const item = record[key];
      if (item === undefined) throw new Error('OPERATIONAL_CANONICAL_UNDEFINED');
      return `${JSON.stringify(key)}:${canonicalValue(item)}`;
    });
    return `{${entries.join(',')}}`;
  }
  throw new Error('OPERATIONAL_CANONICAL_VALUE_INVALID');
};

export const canonicalJson = (value: unknown): string => canonicalValue(value);
export const canonicalSha256 = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
