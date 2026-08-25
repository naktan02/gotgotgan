export function GET(): Response {
  return Response.json({ service: 'place-web', state: 'ok' })
}
