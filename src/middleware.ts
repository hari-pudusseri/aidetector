import { NextResponse, type NextRequest } from "next/server";
import {
	AUTH_COOKIE,
	AUTH_TTL_MS,
	GATE_COOKIE,
	apiGateResponse,
	cookieAttrs,
	gateCookieMaxAgeMs,
	getCookie,
	isApiPath,
	isHttpsRequest,
	isLocked,
	mintAuthCookie,
	mintGateCookie,
	passwordMatches,
	readAuthCookie,
	readGateCookie,
	recordFailedAttempt,
	remainingLockMs,
	sitePasswordFrom,
} from "@/lib/gate";
import { lockoutPageHtml, loginErrorMessage, loginPageHtml } from "@/lib/gate-html";

export async function middleware(request: NextRequest) {
	const now = Date.now();
	const secret = sitePasswordFrom(process.env);
	const secure = isHttpsRequest(request, request.nextUrl);
	const cookieHeader = request.headers.get("cookie");

	if (isApiPath(request.nextUrl.pathname)) {
		const denied = await apiGateResponse(cookieHeader, secret, now);
		return denied ?? NextResponse.next();
	}

	if (!secret) {
		return html(loginPageHtml({ configured: false }), 503);
	}

	if (await readAuthCookie(getCookie(cookieHeader, AUTH_COOKIE), secret, now)) {
		return NextResponse.next();
	}

	const gate = await readGateCookie(getCookie(cookieHeader, GATE_COOKIE), secret, now);
	if (isLocked(gate, now)) {
		const response = html(lockoutPageHtml(remainingLockMs(gate, now)), 429);
		response.cookies.set(GATE_COOKIE, await mintGateCookie(gate, secret), cookieAttrs(gateCookieMaxAgeMs(gate, now), secure));
		return response;
	}

	if (request.method === "POST" && request.nextUrl.pathname === "/" && isSameOriginForm(request)) {
		const form = await request.formData();
		const provided = String(form.get("password") ?? "");
		if (await passwordMatches(provided, secret)) {
			const response = NextResponse.redirect(new URL("/", request.url), 303);
			response.cookies.set(AUTH_COOKIE, await mintAuthCookie(secret, now), cookieAttrs(AUTH_TTL_MS, secure));
			response.cookies.set(GATE_COOKIE, "", { ...cookieAttrs(0, secure), maxAge: 0 });
			return response;
		}

		const nextGate = recordFailedAttempt(gate, now);
		if (isLocked(nextGate, now)) {
			const response = html(lockoutPageHtml(remainingLockMs(nextGate, now)), 429);
			response.cookies.set(GATE_COOKIE, await mintGateCookie(nextGate, secret), cookieAttrs(gateCookieMaxAgeMs(nextGate, now), secure));
			return response;
		}

		const response = html(loginPageHtml({ configured: true, error: loginErrorMessage(nextGate) }), 401);
		response.cookies.set(GATE_COOKIE, await mintGateCookie(nextGate, secret), cookieAttrs(gateCookieMaxAgeMs(nextGate, now), secure));
		return response;
	}

	return html(loginPageHtml({ configured: true }), 200);
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.svg|file.svg|window.svg).*)"],
};

function isSameOriginForm(request: NextRequest): boolean {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
		return false;
	}
	const origin = request.headers.get("origin");
	if (!origin) return true;
	return origin === request.nextUrl.origin;
}

function html(body: string, status: number): NextResponse {
	return new NextResponse(body, {
		status,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
			"X-Robots-Tag": "noindex, nofollow",
		},
	});
}
