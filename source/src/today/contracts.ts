export const DAILY_COMPANION_VERSION = 'dlkt-info-daily-companion-1' as const;
export const DAILY_COMPANION_ROUTE = '/today' as const;
export const DAILY_COMPANION_MODE = 'synthetic-finite-preview' as const;

export interface DailyCompanionContract {
  readonly version: typeof DAILY_COMPANION_VERSION;
  readonly route: typeof DAILY_COMPANION_ROUTE;
  readonly mode: typeof DAILY_COMPANION_MODE;
  readonly finite: true;
  readonly cardBudget: 'user-defined-positive-integer';
  readonly infiniteScroll: false;
  readonly sessionPersistence: false;
  readonly realDataEnabled: false;
}

export const dailyCompanionContract: DailyCompanionContract = Object.freeze({
  version: DAILY_COMPANION_VERSION,
  route: DAILY_COMPANION_ROUTE,
  mode: DAILY_COMPANION_MODE,
  finite: true,
  cardBudget: 'user-defined-positive-integer',
  infiniteScroll: false,
  sessionPersistence: false,
  realDataEnabled: false,
});
