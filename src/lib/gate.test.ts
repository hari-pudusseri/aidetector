import { describe, expect, it } from "vitest";
import {
	AUTH_COOKIE,
	AUTH_TTL_MS,
	GATE_COOKIE,
	LOCKOUT_MS,
	MAX_ATTEMPTS,
	apiGateResponse,
	emptyGate,
	isLocked,
	mintAuthCookie,
	mintGateCookie,
	passwordMatches,
	readAuthCookie,
	readGateCookie,
	recordFailedAttempt,
} from "@/lib/gate";

const SECRET = "correct-horse";
const OTHER = "different-secret";

describe("password matching", () => {
	it("accepts the expected password", async () => {
		await expect(passwordMatches("correct-horse", SECRET)).resolves.toBe(true);
	});

	it("rejects a wrong password", async () => {
		await expect(passwordMatches("incorrect-pass", SECRET)).resolves.toBe(false);
	});
});

describe("auth cookie", () => {
	it("accepts a fresh signed cookie", async () => {
		const now = 1_000_000;
		const cookie = await mintAuthCookie(SECRET, now);
		await expect(readAuthCookie(cookie, SECRET, now + 1000)).resolves.toBe(true);
	});

	it("rejects expiry, tampering, and a different secret", async () => {
		const now = 5_000_000;
		const cookie = await mintAuthCookie(SECRET, now);
		await expect(readAuthCookie(cookie, SECRET, now + AUTH_TTL_MS + 1)).resolves.toBe(false);
		await expect(readAuthCookie(`${cookie}x`, SECRET, now)).resolves.toBe(false);
		await expect(readAuthCookie(cookie, OTHER, now)).resolves.toBe(false);
		await expect(readAuthCookie(undefined, SECRET, now)).resolves.toBe(false);
	});
});

describe("gate lockout cookie", () => {
	it("locks on the third failure and stays locked even if the password would match", async () => {
		const now = 10_000_000;
		let state = emptyGate();
		state = recordFailedAttempt(state, now);
		state = recordFailedAttempt(state, now + 1);
		expect(isLocked(state, now + 1)).toBe(false);
		state = recordFailedAttempt(state, now + 2);
		expect(state.attempts).toBe(MAX_ATTEMPTS);
		expect(isLocked(state, now + 2)).toBe(true);
		expect(state.lockedUntil).toBe(now + 2 + LOCKOUT_MS);

		const cookie = await mintGateCookie(state, SECRET);
		const roundTrip = await readGateCookie(cookie, SECRET, now + 3);
		expect(isLocked(roundTrip, now + 3)).toBe(true);
	});

	it("resets after the lockout window", async () => {
		const now = 20_000_000;
		const locked = recordFailedAttempt(recordFailedAttempt(recordFailedAttempt(emptyGate(), now), now), now);
		const cookie = await mintGateCookie(locked, SECRET);
		await expect(readGateCookie(cookie, SECRET, locked.lockedUntil)).resolves.toEqual(emptyGate());
	});

	it("ignores a tampered lockout cookie instead of trusting it", async () => {
		const cookie = await mintGateCookie({ attempts: 2, lockedUntil: 0 }, SECRET);
		await expect(readGateCookie(`${cookie}nope`, SECRET, 1)).resolves.toEqual(emptyGate());
		await expect(readGateCookie(cookie, OTHER, 1)).resolves.toEqual(emptyGate());
	});
});

describe("API gate", () => {
	it("rejects missing auth and lockout, and allows a valid session", async () => {
		const now = 30_000_000;

		const missing = await apiGateResponse("", SECRET, now);
		expect(missing?.status).toBe(401);

		const lockedState = recordFailedAttempt(recordFailedAttempt(recordFailedAttempt(emptyGate(), now), now), now);
		const locked = await apiGateResponse(`${GATE_COOKIE}=${await mintGateCookie(lockedState, SECRET)}`, SECRET, now);
		expect(locked?.status).toBe(403);

		const ok = await apiGateResponse(`${AUTH_COOKIE}=${await mintAuthCookie(SECRET, now)}`, SECRET, now);
		expect(ok).toBeNull();
	});
});
