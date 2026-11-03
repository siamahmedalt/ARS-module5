/**
 * Module 5 / Sprint 3 / Feature 3 RED-only API placeholder.
 * The actual Registration clearance endpoint is NOT implemented in Sprint 3.
 * Sprint 4 will implement this route to satisfy the unchanged tests.
 *
 * Proposed public contract (subject to M1/M3 agreement):
 * GET /api/v1/fees/clearance/:studentId?termId=TERM
 * Header: Authorization: Bearer <signed service token>
 */
import { createServer } from 'node:http';

export function createClearanceServer({ loadLedger, verifyToken } = {}) {
  // Keep dependencies injectable for test-first API/contract design.
  // Neither loader nor verifier is used yet; this is deliberately RED.
  void loadLedger;
  void verifyToken;
  return createServer((_request, response) => {
    response.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'FEATURE_NOT_IMPLEMENTED' } }));
  });
}
