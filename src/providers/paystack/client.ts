const PAYSTACK_BASE_URL = "https://api.paystack.co";

export interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface PaystackFetch {
  (path: string, init?: RequestInit): Promise<Response>;
}

/**
 * A tiny typed client over `fetch`. There is no official Paystack SDK, so
 * this is deliberately minimal: one method per endpoint the adapter uses,
 * all going through `request` so auth and JSON handling live in one place.
 * `fetchImpl` is injectable so tests never make a live call.
 */
export class PaystackClient {
  private readonly secretKey: string;
  private readonly fetchImpl: PaystackFetch;
  private readonly baseUrl: string;

  constructor(secretKey: string, options?: { fetchImpl?: PaystackFetch; baseUrl?: string }) {
    this.secretKey = secretKey;
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.baseUrl = options?.baseUrl ?? PAYSTACK_BASE_URL;
  }

  async request<T>(path: string, init?: RequestInit): Promise<PaystackResponse<T>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    const body = (await response.json()) as PaystackResponse<T>;
    if (!response.ok || !body.status) {
      throw new Error(`Paystack request to ${path} failed: ${body.message ?? response.statusText}`);
    }
    return body;
  }

  get<T>(path: string): Promise<PaystackResponse<T>> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, payload: unknown): Promise<PaystackResponse<T>> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(payload) });
  }
}
