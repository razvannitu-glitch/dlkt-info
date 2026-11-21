export const VISUAL_REVIEW_CONSOLE_VERSION = 'dlkt-info-visual-review-console-1' as const;
export const VISUAL_REVIEW_CONSOLE_ROUTE = '/review' as const;
export const VISUAL_REVIEW_CONSOLE_MODE = 'synthetic-preview-only' as const;

export interface VisualReviewConsoleContract {
  readonly version: typeof VISUAL_REVIEW_CONSOLE_VERSION;
  readonly route: typeof VISUAL_REVIEW_CONSOLE_ROUTE;
  readonly mode: typeof VISUAL_REVIEW_CONSOLE_MODE;
  readonly candidateLimit: 12;
  readonly decisionsPersisted: false;
  readonly automaticPublication: false;
  readonly publicCardsEnabled: false;
}

export const visualReviewConsoleContract: VisualReviewConsoleContract = Object.freeze({
  version: VISUAL_REVIEW_CONSOLE_VERSION,
  route: VISUAL_REVIEW_CONSOLE_ROUTE,
  mode: VISUAL_REVIEW_CONSOLE_MODE,
  candidateLimit: 12,
  decisionsPersisted: false,
  automaticPublication: false,
  publicCardsEnabled: false,
});
