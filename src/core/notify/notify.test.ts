import { describe, expect, it, vi } from "vitest";
import { renderTemplate } from "./templates";
import { ConsoleNotifier } from "./console";
import { ResendNotifier } from "./resend";
import { RecordingNotifier } from "./recording";

describe("notification templates", () => {
  it("renders all four kinds with a subject, text, and html", () => {
    const cases: Array<[Parameters<typeof renderTemplate>[0], Record<string, unknown>]> = [
      ["payment_failed", { invoiceNumber: "INV-2026-000001", amount: "1000", currency: "USD" }],
      ["retry_scheduled", { invoiceNumber: "INV-2026-000001", nextAttemptAt: "2026-01-04T00:00:00.000Z" }],
      ["subscription_cancelled", { planName: "Growth" }],
      ["payment_recovered", { invoiceNumber: "INV-2026-000001" }],
    ];

    for (const [kind, payload] of cases) {
      const template = renderTemplate(kind, payload);
      expect(template.subject.length).toBeGreaterThan(0);
      expect(template.text.length).toBeGreaterThan(0);
      expect(template.html).toContain(template.text);
    }
  });
});

describe("ConsoleNotifier", () => {
  it("logs without throwing and reports its channel", async () => {
    const notifier = new ConsoleNotifier();
    expect(notifier.channel).toBe("console");
    await expect(
      notifier.send({ kind: "payment_recovered", recipient: "a@example.com", payload: { invoiceNumber: "INV-1" } }),
    ).resolves.toBeUndefined();
  });
});

describe("ResendNotifier", () => {
  it("POSTs to https://api.resend.com/emails with from/to/subject/text/html", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const notifier = new ResendNotifier({ apiKey: "re_test", from: "billing@example.com", fetchImpl });

    await notifier.send({ kind: "payment_recovered", recipient: "customer@example.com", payload: { invoiceNumber: "INV-1" } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: "billing@example.com", to: "customer@example.com" });
    expect(body.subject).toBeTruthy();
    expect(body.text).toBeTruthy();
    expect(body.html).toBeTruthy();
  });

  it("throws when Resend responds with a non-OK status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422 } as Response);
    const notifier = new ResendNotifier({ apiKey: "re_test", from: "billing@example.com", fetchImpl });

    await expect(
      notifier.send({ kind: "payment_recovered", recipient: "customer@example.com", payload: { invoiceNumber: "INV-1" } }),
    ).rejects.toThrow("422");
  });
});

describe("RecordingNotifier", () => {
  it("records sends in order for assertions", async () => {
    const notifier = new RecordingNotifier();
    await notifier.send({ kind: "payment_failed", recipient: "a@example.com", payload: {} });
    await notifier.send({ kind: "payment_recovered", recipient: "a@example.com", payload: {} });
    expect(notifier.sent.map((n) => n.kind)).toEqual(["payment_failed", "payment_recovered"]);
  });
});
