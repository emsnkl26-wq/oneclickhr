import { describe, it, expect } from 'vitest'
import { ROLE_PRESETS, exactRolePreset, rolePresetFor } from '@/lib/role-presets'

describe('rolePresetFor', () => {
  it('finds a listed position by its exact title, ignoring case', () => {
    expect(rolePresetFor('ai/ml engineer')?.title).toBe('AI/ML Engineer')
  })

  it('matches a custom title to the closest role by keyword', () => {
    expect(rolePresetFor('Senior Data Engineer')?.title).toBe('Data Engineer')
    expect(rolePresetFor('Lead Java Developer')?.title).toBe('Java Developer')
    expect(rolePresetFor('Machine Learning Engineer')?.title).toBe('AI/ML Engineer')
    expect(rolePresetFor('Summer Intern')?.title).toBe('Software Engineer Intern')
  })

  it('returns nothing for a title it cannot place, so generic wording is used', () => {
    expect(rolePresetFor('Chef')).toBeNull()
    expect(rolePresetFor('')).toBeNull()
  })

  it('has unique titles and every keyword target exists', () => {
    const titles = ROLE_PRESETS.map((role) => role.title)
    expect(new Set(titles).size).toBe(titles.length)
    for (const title of titles) expect(exactRolePreset(title)?.title).toBe(title)
  })
})
