export const ACTIVATION_ACCOUNT_HANDOFF_VERSION = 'dlkt-info-activation-account-handoff-1' as const;
export const ACTIVATION_ACCOUNT_HANDOFF_SOURCE_ROUTE = '/start' as const;
export const ACTIVATION_ACCOUNT_HANDOFF_DESTINATION_ROUTE = '/companion' as const;

export const activationAccountHandoffContract = Object.freeze({
  version: ACTIVATION_ACCOUNT_HANDOFF_VERSION,
  sourceRoute: ACTIVATION_ACCOUNT_HANDOFF_SOURCE_ROUTE,
  destinationRoute: ACTIVATION_ACCOUNT_HANDOFF_DESTINATION_ROUTE,
  identityMethod: 'email-otp',
  sessionBoundary: 'http-only-cookie',
  persistenceAdapter: 'dlkt-info-persistence-2',
  persistenceMode: 'dedicated-runtime-gate',
  exactContractSave: true,
  crossDeviceRestore: true,
  explicitUrlWins: true,
  entityCapacity: 'payload-bounded',
  cardBudget: 'user-defined-positive-integer',
  browserStorage: false,
  automaticExecution: false,
  factualStateMutation: false,
} as const);
