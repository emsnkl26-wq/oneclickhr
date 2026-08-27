import { describe, it, expect } from 'vitest'
import { isStaleBundleError } from '@/lib/stale-bundle'

/**
 * The deploy-stranded-tab case.
 *
 * This decides whether the error boundary quietly reloads or shows "Something
 * went wrong". Both directions cost something if it is wrong: a false negative
 * strands the user on a screen whose "Try again" button can never work, and a
 * false positive turns a real bug into an infinite-looking reload.
 */
describe('isStaleBundleError', () => {
  const err = (name: string, message: string) => ({ name, message })

  it('catches the error name webpack/React actually throws', () => {
    expect(isStaleBundleError(err('ChunkLoadError', 'Loading chunk 42 failed.'))).toBe(true)
  })

  it('catches a failed JS chunk by message alone', () => {
    expect(isStaleBundleError(err('Error', 'Loading chunk app/page-a1b2c3 failed.'))).toBe(true)
  })

  it('catches a failed CSS chunk', () => {
    expect(isStaleBundleError(err('Error', 'Loading CSS chunk 7 failed.'))).toBe(true)
  })

  it("catches Chrome's wording for a dead dynamic import", () => {
    expect(isStaleBundleError(
      err('TypeError', 'Failed to fetch dynamically imported module: https://app/_next/static/x.js')
    )).toBe(true)
  })

  it("catches Firefox's wording", () => {
    expect(isStaleBundleError(err('TypeError', 'error loading dynamically imported module'))).toBe(true)
  })

  it("catches Safari's wording", () => {
    expect(isStaleBundleError(err('TypeError', 'Importing a module script failed.'))).toBe(true)
  })

  it('leaves an ordinary application error alone', () => {
    // This one must reach the real error screen, not trigger a reload loop.
    expect(isStaleBundleError(err('Error', 'That timesheet could not be loaded.'))).toBe(false)
  })

  it('leaves a database failure alone', () => {
    expect(isStaleBundleError(err('Error', 'The hours on this timesheet could not be loaded.'))).toBe(false)
  })

  it('does not match the word "chunk" used incidentally', () => {
    expect(isStaleBundleError(err('Error', 'Uploading chunk 3 of 9 failed to save'))).toBe(false)
  })

  it('survives a null or half-formed error without throwing', () => {
    expect(isStaleBundleError(null)).toBe(false)
    expect(isStaleBundleError({})).toBe(false)
    expect(isStaleBundleError({ message: 'ChunkLoadError' })).toBe(true)
  })
})
