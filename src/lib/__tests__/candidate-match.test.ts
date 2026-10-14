import { describe, it, expect } from 'vitest'
import {
  tokenize, parseRequirement, scoreCandidate, type CandidateText,
} from '@/lib/candidate-match'

/** A candidate with nothing filled in, so each test states only what it means. */
const person = (overrides: Partial<CandidateText> = {}): CandidateText => ({
  skills: [],
  headline: [],
  prose: [],
  years: null,
  ...overrides,
})

const score = (requirement: Parameters<typeof scoreCandidate>[0], candidate: CandidateText) =>
  scoreCandidate(requirement, candidate).score

describe('tokenize', () => {
  /**
   * The reason this is not `\w+`. Four of the most specific requirements a US
   * staffing role can carry are punctuation away from being worthless tokens.
   */
  it('keeps the punctuation that is part of a technology name', () => {
    expect(tokenize('C++, C#, .NET and Node.js')).toEqual(['c++', 'c#', 'net', 'node.js'])
  })

  it('drops recruitment boilerplate and bare numbers', () => {
    expect(tokenize('5 years of strong experience working with the team')).toEqual([])
  })

  it('is case- and separator-insensitive', () => {
    expect(tokenize('Salesforce / APEX;  LWC')).toEqual(['salesforce', 'apex', 'lwc'])
  })
})

describe('parseRequirement', () => {
  it('weighs the title above the body', () => {
    const requirement = parseRequirement({ title: 'Salesforce', description: 'kubernetes' })
    expect(requirement.terms.get('salesforce')).toBeGreaterThan(
      requirement.terms.get('kubernetes') as number
    )
  })

  /**
   * The decision that makes the ranking feel right: a description mentions the
   * actual technology once and says "collaborate" four times, and the title is
   * what a human reads first.
   */
  it('ranks a title term above a term the body repeats', () => {
    const requirement = parseRequirement({
      title: 'Salesforce Developer',
      description: 'collaborate collaborate collaborate collaborate with salesforce',
    })
    expect(requirement.terms.get('salesforce')).toBeGreaterThan(
      requirement.terms.get('collaborate') as number
    )
  })

  it('caps the term list so a long description cannot dilute every score', () => {
    const words = Array.from({ length: 300 }, (_, index) => `term${index}`).join(' ')
    expect(parseRequirement({ description: words }).terms.size).toBe(60)
  })

  it('reads the smallest year figure out of the description', () => {
    expect(parseRequirement({ description: '3+ years overall, 7 years in a lead role' }).minYears)
      .toBe(3)
  })

  it('prefers a stated minimum over one it could have inferred', () => {
    expect(parseRequirement({ description: '8 years required', minYears: 2 }).minYears).toBe(2)
  })
})

describe('scoreCandidate', () => {
  const requirement = parseRequirement({ title: 'Salesforce Developer' })

  it('scores a declared skill above the same word in prose', () => {
    const declared = score(requirement, person({ skills: ['Salesforce'] }))
    const mentioned = score(
      requirement,
      person({ prose: ['I would love to learn Salesforce one day'] })
    )
    expect(declared).toBeGreaterThan(mentioned)
    expect(mentioned).toBeGreaterThan(0)
  })

  /**
   * Without "best band wins", the candidate who writes the most about
   * themselves beats the candidate who has actually done the work.
   */
  it('counts a term once, however many times a candidate repeats it', () => {
    const once = score(requirement, person({ skills: ['Salesforce', 'Developer'] }))
    const everywhere = score(
      requirement,
      person({
        skills: ['Salesforce', 'Developer'],
        headline: ['Salesforce Developer'],
        prose: ['salesforce salesforce salesforce developer'],
      })
    )
    expect(everywhere).toBe(once)
  })

  it('reports exactly which terms produced the score', () => {
    const result = scoreCandidate(requirement, person({ skills: ['Salesforce', 'Kubernetes'] }))
    expect(result.matched).toContain('salesforce')
    expect(result.matched).not.toContain('kubernetes')
  })

  it('gives nothing to somebody with nothing in common', () => {
    expect(score(requirement, person({ skills: ['Welding'] }))).toBe(0)
  })

  it('reaches 100 only when every requirement is a declared skill', () => {
    expect(score(requirement, person({ skills: ['Salesforce', 'Developer'] }))).toBe(100)
  })

  /**
   * Experience is a multiplier, not a filter — the person who is one year
   * short and perfect on everything else is somebody we would still call.
   */
  it('pushes somebody short on experience down the list, not off it', () => {
    const senior = parseRequirement({ title: 'Salesforce Developer', minYears: 5 })
    const short = scoreCandidate(senior, person({ skills: ['Salesforce', 'Developer'], years: 3 }))
    const met = scoreCandidate(senior, person({ skills: ['Salesforce', 'Developer'], years: 6 }))

    expect(short.years.short).toBe(true)
    expect(short.score).toBeGreaterThan(0)
    expect(short.score).toBeLessThan(met.score)
  })

  it('nudges unknown experience below a candidate who stated enough', () => {
    const senior = parseRequirement({ title: 'Salesforce Developer', minYears: 5 })
    const unknown = score(senior, person({ skills: ['Salesforce', 'Developer'] }))
    const stated = score(senior, person({ skills: ['Salesforce', 'Developer'], years: 6 }))
    expect(unknown).toBeLessThan(stated)
    expect(unknown).toBeGreaterThan(0)
  })

  it('scores nobody against an empty requirement rather than dividing by zero', () => {
    const empty = parseRequirement({ title: '', description: '' })
    expect(score(empty, person({ skills: ['Salesforce'] }))).toBe(0)
  })
})
