import { createServer } from 'node:http'
import { SMTPServer } from 'smtp-server'

const messages = []
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  name: 'ctrorec.test',
  secure: false,
  onData(stream, session, callback) {
    const chunks = []
    let size = 0
    stream.on('data', (chunk) => {
      size += chunk.length
      if (size <= 1_048_576) {
        chunks.push(chunk)
      }
    })
    stream.on('end', () => {
      if (size > 1_048_576) {
        callback(new Error('Test message exceeded the capture limit.'))
        return
      }
      try {
        const parsed = parseMessage(Buffer.concat(chunks).toString('utf8'))
        messages.push({
          to: session.envelope.rcptTo.map((recipient) => recipient.address),
          from: session.envelope.mailFrom.address,
          ...parsed,
        })
        callback()
      } catch (error) {
        callback(error instanceof Error ? error : new Error('Invalid message.'))
      }
    })
    stream.on('error', callback)
  },
})

const http = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }
  if (request.url === '/messages') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    })
    response.end(JSON.stringify(messages))
    return
  }
  response.writeHead(404)
  response.end()
})

smtp.listen(2525, '127.0.0.1', () => {
  console.log('Test SMTP catcher listening on 127.0.0.1:2525')
})
http.listen(2526, '127.0.0.1', () => {
  console.log('Test SMTP capture API listening on 127.0.0.1:2526')
})

function parseMessage(raw) {
  const separator = raw.indexOf('\r\n\r\n')
  if (separator < 0) {
    throw new Error('The captured MIME message has no body.')
  }
  const headerText = raw.slice(0, separator)
  const encodedBody = raw.slice(separator + 4).replace(/\r\n\.\r\n$/, '')
  const subject = headerText.match(/^Subject: (.+)$/im)?.[1] ?? ''
  const transferEncoding =
    headerText
      .match(/^Content-Transfer-Encoding: (.+)$/im)?.[1]
      ?.trim()
      .toLowerCase() ?? '7bit'
  const text =
    transferEncoding === 'base64'
      ? Buffer.from(encodedBody.replace(/\s/g, ''), 'base64').toString('utf8')
      : transferEncoding === 'quoted-printable'
        ? decodeQuotedPrintable(encodedBody)
        : encodedBody
  return { subject, text }
}

function decodeQuotedPrintable(value) {
  const bytes = []
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '=' && value.slice(index + 1, index + 3) === '\r\n') {
      index += 2
      continue
    }
    const hexadecimal = value.slice(index + 1, index + 3)
    if (character === '=' && /^[0-9A-Fa-f]{2}$/.test(hexadecimal)) {
      bytes.push(Number.parseInt(hexadecimal, 16))
      index += 2
      continue
    }
    bytes.push(character.charCodeAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}

async function shutdown() {
  await new Promise((resolve) => smtp.close(resolve))
  await new Promise((resolve) => http.close(resolve))
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
