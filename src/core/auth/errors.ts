export class RateLimitedError extends Error {
  constructor(email: string) {
    super(`Too many magic links requested for ${email}; try again later`);
    this.name = "RateLimitedError";
  }
}

export class InvalidMagicLinkError extends Error {
  constructor(reason: "not_found" | "used" | "expired") {
    super(`Magic link is invalid: ${reason}`);
    this.name = "InvalidMagicLinkError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}
