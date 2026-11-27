import { describe, expect, it } from 'vitest'
import {
  addBackup,
  DEFAULT_CONFIG,
  moveBackup,
  normalizeLogin,
  removeBackup,
  sanitizeConfig,
  setPrimary,
  validateLogin,
} from './streamerConfig'

const cfg = { primary: 'jynxzi', backups: ['kaicenat', 'xqc', 'pokimane'] }

describe('defaults', () => {
  it('come from the shared config file', () => {
    expect(DEFAULT_CONFIG.primary).toBe('jynxzi')
    expect(DEFAULT_CONFIG.backups[0]).toBe('kaicenat')
    expect(DEFAULT_CONFIG.backups).toContain('xqc')
    expect(DEFAULT_CONFIG.backups).toContain('ishowspeed')
    expect(DEFAULT_CONFIG.backups).toContain('pokimane')
    expect(DEFAULT_CONFIG.backups).toHaveLength(39)
  })
})

describe('validateLogin', () => {
  it('normalizes @, urls and case', () => {
    expect(normalizeLogin('  @XQC ')).toBe('xqc')
    expect(normalizeLogin('https://www.twitch.tv/Kaicenat')).toBe('kaicenat')
  })
  it.each(['', 'ab', 'has space', 'bad-name', 'a'.repeat(26), 'émile_x'])('rejects %j', (v) => {
    expect(validateLogin(v).error).toBeTruthy()
  })
  it('accepts valid logins and rejects duplicates', () => {
    expect(validateLogin('Valid_123').error).toBeNull()
    expect(validateLogin('XQC', ['xqc']).error).toMatch(/already/)
  })
})

describe('list operations', () => {
  it('adds, and rejects invalid or duplicate input without changing the config', () => {
    expect(addBackup(cfg, 'newguy').config.backups.at(-1)).toBe('newguy')
    expect(addBackup(cfg, 'jynxzi').config).toBe(cfg)
    expect(addBackup(cfg, '!!').error).toBeTruthy()
  })
  it('removes backups only', () => {
    expect(removeBackup(cfg, 'xqc').backups).toEqual(['kaicenat', 'pokimane'])
    expect(removeBackup(cfg, 'jynxzi')).toEqual(cfg)
  })
  it('promotes a backup and demotes the old primary to first backup', () => {
    expect(setPrimary(cfg, 'xqc')).toEqual({ primary: 'xqc', backups: ['jynxzi', 'kaicenat', 'pokimane'] })
    expect(setPrimary(cfg, 'nobody')).toBe(cfg)
  })
  it('reorders within bounds', () => {
    expect(moveBackup(cfg, 'xqc', -1).backups).toEqual(['xqc', 'kaicenat', 'pokimane'])
    expect(moveBackup(cfg, 'kaicenat', -1)).toBe(cfg)
    expect(moveBackup(cfg, 'pokimane', 1)).toBe(cfg)
  })
})

describe('sanitizeConfig', () => {
  it('falls back to defaults for junk', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(sanitizeConfig({ primary: 'x', backups: [] })).toEqual(DEFAULT_CONFIG)
  })
  it('drops invalid and duplicate entries', () => {
    expect(sanitizeConfig({ primary: 'Jynxzi', backups: ['xqc', 'XQC', 'jynxzi', 7, 'bad name'] })).toEqual({
      primary: 'jynxzi',
      backups: ['xqc'],
    })
  })
})
