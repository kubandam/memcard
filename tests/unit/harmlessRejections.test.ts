import { describe, expect, it } from 'vitest'
import { isHarmlessRejection } from '../../app/utils/harmlessRejections'

describe('isHarmlessRejection', () => {
  it('matches a denied Wake Lock request only', () => {
    expect(isHarmlessRejection(Object.assign(new Error('Wake Lock permission request denied'), { name: 'NotAllowedError' }))).toBe(true)
    expect(isHarmlessRejection(Object.assign(new Error('play() failed because the user didn\'t interact'), { name: 'NotAllowedError' }))).toBe(true)
    expect(isHarmlessRejection(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }))).toBe(false)
    expect(isHarmlessRejection(new TypeError('x is undefined'))).toBe(false)
    expect(isHarmlessRejection(null)).toBe(false)
  })
})
