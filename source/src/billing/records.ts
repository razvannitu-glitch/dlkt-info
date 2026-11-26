/** Read own data fields from decoded server-side records, never inherited or accessor values. */
export function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}
export function field(value: Record<string, unknown> | null, key: string): unknown {
  if (!value) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value as unknown : undefined;
}
export function stripeId(value: unknown, prefix: 'acct' | 'prod' | 'price' | 'cus' | 'sub' | 'in'): value is string {
  return typeof value === 'string' && value.length <= 255 && new RegExp('^' + prefix + '_[A-Za-z0-9]+$', 'u').test(value);
}
export function unixSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 253402300799;
}
