"use server";

import { redirect } from "next/navigation";
import { RateLimitedError, requestMagicLink, safeNext } from "@/core/auth";
import { db } from "@/db/client";
import { magicLinkNotifier } from "@/core/notify";

export async function requestMagicLinkAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeNext(formData.get("next")?.toString());
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";

  if (!email) {
    redirect(`/login?error=invalid_email${nextQuery}`);
  }

  try {
    await requestMagicLink(db, email, { notifier: magicLinkNotifier(), next });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      redirect(`/login?error=rate_limited${nextQuery}`);
    }
    throw error;
  }

  redirect(`/login?sent=1${nextQuery}`);
}
