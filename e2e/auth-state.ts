/** Storage-state file paths shared between `auth.setup.ts` (which writes them) and the specs that reuse them via `test.use({ storageState })`. */
export const CUSTOMER_STORAGE_STATE = "e2e/.auth/customer.json";
export const OPERATOR_STORAGE_STATE = "e2e/.auth/operator.json";
