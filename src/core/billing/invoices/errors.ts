import type { Invoice } from "@/db/schema";

/** Thrown when an operation requires an invoice to be in a status it isn't in (e.g. paying a `void`/`uncollectible`/`draft` invoice). */
export class InvalidInvoiceStateError extends Error {
  readonly invoiceId: string;
  readonly status: Invoice["status"];

  constructor(invoiceId: string, status: Invoice["status"], action: string) {
    super(`Cannot ${action} invoice ${invoiceId}: it is "${status}", not "open"`);
    this.name = "InvalidInvoiceStateError";
    this.invoiceId = invoiceId;
    this.status = status;
  }
}
