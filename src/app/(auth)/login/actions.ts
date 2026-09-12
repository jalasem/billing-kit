"use server";

import { redirect } from "next/navigation";
import { RateLimitedError, requestMagicLink } from "@/core/auth";
import { db } from "@/db/client";
import { defaultNotifier } from "@/core/notify";

function safeNext(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }
  return value;
}

export async function requestMagicLinkAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeNext(formData.get("next"));
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";

  if (!email) {
    redirect(`/login?error=invalid_email${nextQuery}`);
  }

  try {
    await requestMagicLink(db, email, { notifier: defaultNotifier(), next });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      redirect(`/login?error=rate_limited${nextQuery}`);
    }
    throw error;
  }

  redirect(`/login?sent=1${nextQuery}`);
}
