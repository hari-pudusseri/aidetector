const encoder = new TextEncoder();

export const AUTH_COOKIE = "tt_ok";
export const GATE_COOKIE = "tt_gate";
export const MAX_ATTEMPTS = 3;
export const LOCKOUT_MS = 10 * 60 * 1000;
export const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type GateState = {
	attempts: number;
	lockedUntil: number;
};

export type CookieAttrs = {
	httpOnly: true;
	secure: boolean;
	sameSite: "strict";
	path: "/";
	maxAge: number;
};

type AuthPayload = { e: number };
type GatePayload = { n: number; u: number };

export function emptyGate(): GateState {
	return { attempts: 0, lockedUntil: 0 };
}

export function sitePasswordFrom(env: Record<string, string | undefined> | NodeJS.ProcessEnv): string | undefined {
	// Dynamic key so Next.js does not inline this secret into the middleware bundle at build time.
	const value = env[["SITE", "PASSWORD"].join("_")]?.trim();
	return value || undefined;
}

export function cookieAttrs(maxAgeMs: number, secure: boolean): CookieAttrs {
	return {
		httpOnly: true,
		secure,
		sameSite: "strict",
		path: "/",
		maxAge: Math.max(1, Math.ceil(maxAgeMs / 1000)),
	};
}

export function isHttpsRequest(request: Request, url: URL): boolean {
	if (url.protocol === "https:") return true;
	return request.headers.get("x-forwarded-proto") === "https";
}

export function isApiPath(pathname: string): boolean {
	return pathname === "/api" || pathname.startsWith("/api/");
}

export function getCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
	if (!cookieHeader) return undefined;
	for (const part of cookieHeader.split(";")) {
		const index = part.indexOf("=");
		if (index === -1) continue;
		if (part.slice(0, index).trim() !== name) continue;
		return part.slice(index + 1).trim();
	}
	return undefined;
}

export async function passwordMatches(provided: string, expected: string): Promise<boolean> {
	const [left, right] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(provided)),
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
	]);
	return timingSafeEqual(left, right);
}

export async function mintAuthCookie(secret: string, now: number): Promise<string> {
	return signPayload({ e: now + AUTH_TTL_MS }, secret);
}

export async function mintGateCookie(state: GateState, secret: string): Promise<string> {
	return signPayload({ n: state.attempts, u: state.lockedUntil }, secret);
}

export async function readAuthCookie(
	value: string | undefined,
	secret: string,
	now: number,
): Promise<boolean> {
	const payload = await verifyPayload<AuthPayload>(value, secret, isAuthPayload);
	return Boolean(payload && payload.e > now);
}

export async function readGateCookie(
	value: string | undefined,
	secret: string,
	now: number,
): Promise<GateState> {
	const payload = await verifyPayload<GatePayload>(value, secret, isGatePayload);
	if (!payload) return emptyGate();
	if (payload.u > 0 && payload.u <= now) return emptyGate();
	return { attempts: payload.n, lockedUntil: payload.u };
}

export function isLocked(state: GateState, now: number): boolean {
	return state.lockedUntil > now;
}

export function remainingLockMs(state: GateState, now: number): number {
	return Math.max(0, state.lockedUntil - now);
}

export function recordFailedAttempt(state: GateState, now: number): GateState {
	if (isLocked(state, now)) return state;
	const attempts = state.attempts + 1;
	if (attempts >= MAX_ATTEMPTS) {
		return { attempts, lockedUntil: now + LOCKOUT_MS };
	}
	return { attempts, lockedUntil: 0 };
}

export function triesLeft(state: GateState): number {
	return Math.max(0, MAX_ATTEMPTS - state.attempts);
}

export async function apiGateResponse(
	cookieHeader: string | null | undefined,
	secret: string | undefined,
	now = Date.now(),
): Promise<Response | null> {
	if (!secret) {
		return Response.json({ error: "Access is not configured." }, { status: 503 });
	}
	if (await readAuthCookie(getCookie(cookieHeader, AUTH_COOKIE), secret, now)) {
		return null;
	}
	const gate = await readGateCookie(getCookie(cookieHeader, GATE_COOKIE), secret, now);
	if (isLocked(gate, now)) {
		return Response.json({ error: "Locked out. Try again later." }, { status: 403 });
	}
	return Response.json({ error: "Password required." }, { status: 401 });
}

export function gateCookieMaxAgeMs(state: GateState, now: number): number {
	if (isLocked(state, now)) return remainingLockMs(state, now);
	return LOCKOUT_MS;
}

async function signPayload(payload: object, secret: string): Promise<string> {
	const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
	const signature = await hmac(secret, body);
	return `${body}.${signature}`;
}

async function verifyPayload<T>(
	value: string | undefined,
	secret: string,
	guard: (value: unknown) => value is T,
): Promise<T | null> {
	if (!value) return null;
	const dot = value.lastIndexOf(".");
	if (dot <= 0) return null;
	const body = value.slice(0, dot);
	const signature = value.slice(dot + 1);
	if (!body || !signature) return null;
	const expected = await hmac(secret, body);
	if (!(await hmacEqual(signature, expected))) return null;
	try {
		const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
		return guard(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isAuthPayload(value: unknown): value is AuthPayload {
	return isRecord(value) && isFiniteInt(value.e);
}

function isGatePayload(value: unknown): value is GatePayload {
	return isRecord(value) && isFiniteInt(value.n) && value.n >= 0 && isFiniteInt(value.u) && value.u >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFiniteInt(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

async function hmac(secret: string, message: string): Promise<string> {
	const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(`telltale-gate-v1:${secret}`));
	const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	return bytesToBase64Url(new Uint8Array(signature));
}

async function hmacEqual(left: string, right: string): Promise<boolean> {
	const [leftHash, rightHash] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(left)),
		crypto.subtle.digest("SHA-256", encoder.encode(right)),
	]);
	return timingSafeEqual(leftHash, rightHash);
}

function timingSafeEqual(left: BufferSource, right: BufferSource): boolean {
	const a = toBytes(left);
	const b = toBytes(right);
	if (a.length !== b.length) return false;
	const subtle = crypto.subtle as SubtleCrypto & {
		timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean;
	};
	if (typeof subtle.timingSafeEqual === "function") {
		return subtle.timingSafeEqual(a, b);
	}
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
	return diff === 0;
}

function toBytes(value: BufferSource): Uint8Array<ArrayBuffer> {
	const view = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	const copy = new Uint8Array(view.byteLength);
	copy.set(view);
	return copy;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
