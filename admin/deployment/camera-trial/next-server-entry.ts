// Package the official HTTP classes without importing Next's unrelated image
// renderer/worker entry points. Route handlers keep the same Next API contract.
export { NextRequest } from 'next/dist/server/web/spec-extension/request';
export { NextResponse } from 'next/dist/server/web/spec-extension/response';
