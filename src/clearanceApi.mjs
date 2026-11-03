/**
 * CSE430 / ARS Module 5 / Sprint 4 — Feature 3 GREEN implementation.
 * GET /api/v1/fees/clearance/:studentId?termId=...
 *
 * This API is an HTTP adapter for the previously implemented Feature 1 fee
 * clearance rules; it deliberately does not duplicate financial arithmetic.
 * Amounts are integer poisha (BDT), never floating-point Tk.
 *
 * Dependencies are supplied by the composition root:
 *   verifyToken(bearerToken): Promise<{ userId, role } | null>
 *   loadLedger({ studentId, termId }): Promise<{ invoices, payments }>
 *
 * SECURITY: This module never considers a bearer token verified by itself.
 * Production must inject Module 1's actual signed-token verifier and a
 * PostgreSQL-backed, authorized ledger loader. The Sprint 3 tests use mocks.
 */
import { createServer } from 'node:http';
import { getClearance } from './feeClearanceService.mjs';

const PATH = /^\/api\/v1\/fees\/clearance\/([^/]+)\/?$/;

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, { error: { code, message } });
}

function hasValidId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

/**
 * Create an HTTP server without starting it (tests call server.listen()).
 * Both dependencies are mandatory for a working, fail-closed deployment.
 */
export function createClearanceServer({ loadLedger, verifyToken } = {}) {
  return createServer(async (request, response) => {
    let route;
    try {
      route = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      sendError(response, 400, 'INVALID_REQUEST', 'Invalid request URL');
      return;
    }

    const match = PATH.exec(route.pathname);
    if (!match) {
      sendError(response, 404, 'NOT_FOUND', 'API endpoint not found');
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendError(response, 405, 'METHOD_NOT_ALLOWED', 'Use GET for fee clearance');
      return;
    }

    // A missing/malformed bearer token must be denied before any ledger read.
    const authorization = request.headers.authorization;
    const bearer = typeof authorization === 'string'
      ? /^Bearer\s+([^\s]+)$/i.exec(authorization)
      : null;
    if (!bearer) {
      sendError(response, 401, 'UNAUTHENTICATED', 'Valid authentication is required');
      return;
    }
    if (typeof verifyToken !== 'function') {
      sendError(response, 503, 'DEPENDENCY_UNAVAILABLE', 'Authentication service unavailable');
      return;
    }

    let principal;
    try {
      principal = await verifyToken(bearer[1]);
    } catch {
      sendError(response, 503, 'DEPENDENCY_UNAVAILABLE', 'Authentication service unavailable');
      return;
    }
    if (!principal || !hasValidId(principal.userId)) {
      sendError(response, 401, 'UNAUTHENTICATED', 'Authentication failed');
      return;
    }
    if (principal.role !== 'REGISTRATION_SERVICE') {
      sendError(response, 403, 'FORBIDDEN', 'Registration service role required');
      return;
    }

    let studentId;
    try {
      studentId = decodeURIComponent(match[1]);
    } catch {
      sendError(response, 400, 'INVALID_REQUEST', 'Invalid student identifier');
      return;
    }
    const termId = route.searchParams.get('termId');
    if (!hasValidId(studentId) || !hasValidId(termId)) {
      sendError(response, 400, 'INVALID_REQUEST', 'studentId and termId are required');
      return;
    }
    if (typeof loadLedger !== 'function') {
      sendError(response, 503, 'DEPENDENCY_UNAVAILABLE', 'Fee ledger unavailable');
      return;
    }

    try {
      const ledger = await loadLedger({ studentId, termId });
      const result = getClearance({
        studentId,
        termId,
        invoices: ledger?.invoices,
        payments: ledger?.payments,
      });
      sendJson(response, 200, {
        studentId: result.studentId,
        termId: result.termId,
        status: result.status,
        outstanding_minor: result.outstanding_minor,
        currency: result.currency,
        evaluatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_VALID_INVOICE_FOR_STUDENT_TERM') {
        sendError(response, 404, 'NOT_FOUND', 'Student/term fee record not found');
        return;
      }
      // Never disclose SQL details, student invoice rows, or stack traces.
      sendError(response, 503, 'DEPENDENCY_UNAVAILABLE', 'Fee clearance unavailable');
    }
  });
}
