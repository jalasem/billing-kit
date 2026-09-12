import { Button, Card, Field } from "@/components/ui";
import { requestMagicLinkAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const sent = params.sent === "1";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sign in to billing-kit</h1>
        <p className="mt-1 text-sm text-slate-600">We&apos;ll email you a link — no password needed.</p>
      </div>
      <Card>
        {sent ? (
          <p className="text-sm text-slate-900" role="status">
            Check your inbox for a sign-in link. It expires in 15 minutes and can only be used once.
          </p>
        ) : (
          <form action={requestMagicLinkAction} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={params.next ?? ""} />
            <Field label="Email address" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
            {params.error === "rate_limited" && (
              <p className="text-sm text-red-700" role="alert">
                Too many links requested for that email. Try again in an hour.
              </p>
            )}
            {params.error === "invalid_email" && (
              <p className="text-sm text-red-700" role="alert">
                Enter an email address.
              </p>
            )}
            <Button type="submit">Send magic link</Button>
          </form>
        )}
      </Card>
    </main>
  );
}
