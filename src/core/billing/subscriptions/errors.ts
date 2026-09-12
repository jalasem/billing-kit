/** Thrown by `createSubscription` when the requested plan has been deactivated (`plans.active = false`). */
export class PlanNotActiveError extends Error {
  readonly planId: string;

  constructor(planId: string) {
    super(`Plan ${planId} is not active`);
    this.name = "PlanNotActiveError";
    this.planId = planId;
  }
}
