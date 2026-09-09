import { describe, it, expect } from 'vitest'
import {
  COUNTRY_CODES, countryName, divisionLabel, divisionsFor, formatLocation,
} from '@/lib/geo'

describe('country list', () => {
  it('names every code it offers', () => {
    for (const code of COUNTRY_CODES) {
      expect(countryName(code), code).not.toBe(code)
    }
  })

  it('falls back to the code itself for anything unlisted', () => {
    expect(countryName('PT')).toBe('PT')
  })
})

describe('divisions', () => {
  it('calls the first level what that country calls it', () => {
    expect(divisionLabel('US')).toBe('State')
    expect(divisionLabel('GB')).toBe('Country / region')
    expect(divisionLabel('AE')).toBe('Emirate')
    expect(divisionLabel('JP')).toBe('Prefecture')
  })

  it('has a neutral label for a country it does not know', () => {
    expect(divisionLabel('PT')).toBe('State / region')
  })

  it('lists divisions for the countries it claims to', () => {
    expect(divisionsFor('US')).toContain('Texas')
    expect(divisionsFor('IN')).toContain('Karnataka')
    expect(divisionsFor('AU')).toContain('Victoria')
  })

  it('returns an empty list — not undefined — where it has no data, so the form falls back to text', () => {
    expect(divisionsFor('PT')).toEqual([])
    expect(divisionsFor('')).toEqual([])
  })
})

describe('formatLocation', () => {
  it('writes the country out by name, never as a code', () => {
    expect(formatLocation({ city: 'Bengaluru', state: 'Karnataka', country: 'IN' })).toBe(
      'Bengaluru, Karnataka, India'
    )
  })

  it('skips the parts that were left blank rather than leaving stray commas', () => {
    expect(formatLocation({ city: 'Austin', country: 'US' })).toBe('Austin, United States')
    expect(formatLocation({ country: 'US' })).toBe('United States')
    expect(formatLocation({ city: '  ', state: null, country: null })).toBe('')
  })

  it('leaves the street address out — a public posting is not a doorstep', () => {
    const line = formatLocation({
      address: '14 Bell Street', city: 'Austin', state: 'Texas', country: 'US',
    })
    expect(line).toBe('Austin, Texas, United States')
    expect(line).not.toContain('Bell Street')
  })

  it('is empty for a job with no location at all', () => {
    expect(formatLocation({})).toBe('')
  })
})
