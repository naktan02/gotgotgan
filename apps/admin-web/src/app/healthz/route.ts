export function GET(): Response {
  return Response.json({
    schemaVersion: 'place-process-status.v1',
    service: 'place-admin-web',
    state: 'ok',
  })
}
