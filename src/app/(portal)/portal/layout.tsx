import { redirect } from "next/navigation";
import { Button } from "@/components/ui";
import { getSession } from "@/core/auth";

const NAV_LINKS = [
  { href: "/portal", label: "Plan" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/payment-method", label: "Payment method" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !session.customerId) {
    redirect("/login?next=/portal");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav aria-label="Portal" className="flex gap-4 text-sm font-medium text-slate-700">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded px-1 py-0.5 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{session.email}</span>
            <form action="/logout" method="post">
              <Button type="submit" variant="secondary">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
