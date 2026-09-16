export function readPublicationRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 64 * 1024) reject(new Error('request too large'))
    })
    request.on('end', () => {
      try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

export function sendPublicationJson(
  response,
  status,
  value,
  contentType = 'application/json',
) {
  if (response.destroyed || response.writableEnded) return
  response.statusCode = status
  response.setHeader('content-type', contentType)
  response.setHeader('x-content-type-options', 'nosniff')
  response.end(JSON.stringify(value))
}
