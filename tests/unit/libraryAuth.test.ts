// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { checkInvite, verifyBearer } from '../../server/utils/libraryAuth'
import { authVerifierHex, toAuthHeader } from '../../shared/utils/libraryKeys'

function eventWith(headers: Record<string, string>) {
  const req = new IncomingMessage(new Socket())
  req.headers = headers
  return createEvent(req, new ServerResponse(req))
}

describe('library auth', () => {
  it('accepts the right bearer and rejects wrong or missing ones', async () => {
    const kAuth = crypto.getRandomValues(new Uint8Array(32))
    const verifier = await authVerifierHex(kAuth)
    expect(await verifyBearer(eventWith({ authorization: `Bearer ${toAuthHeader(kAuth)}` }), verifier)).toBe(true)
    expect(await verifyBearer(eventWith({ authorization: `Bearer ${toAuthHeader(new Uint8Array(32))}` }), verifier)).toBe(false)
    expect(await verifyBearer(eventWith({}), verifier)).toBe(false)
    expect(await verifyBearer(eventWith({ authorization: 'Basic x' }), verifier)).toBe(false)
  })
  it('invite must be listed', () => {
    expect(checkInvite('a, b', 'b')).toBe(true)
    expect(checkInvite('a,b', 'c')).toBe(false)
    expect(checkInvite(undefined, 'a')).toBe(false)
    expect(checkInvite('a', '')).toBe(false)
  })
})
