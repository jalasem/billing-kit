/** `OPERATOR_EMAILS` is a comma-separated list; matching is case-insensitive. */
export function isOperatorEmail(email: string): boolean {
  const configured = process.env.OPERATOR_EMAILS ?? "";
  const operators = configured
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return operators.includes(email.trim().toLowerCase());
}
