import { NextResponse } from "next/server";
import { endSession } from "@/core/auth";

export async function POST(request: Request): Promise<NextResponse> {
  await endSession();
  return NextResponse.redirect(new URL("/login", request.url));
}
