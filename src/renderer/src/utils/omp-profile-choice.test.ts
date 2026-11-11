import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ompProfileChoice, ompProfileFromChoice, ompProfileOptions } from './omp-profile-choice'

test('the picker starts on the workspace profile, or on the default one', () => {
  assert.deepEqual(ompProfileChoice('work'), { kind: 'named', name: 'work' })
  assert.deepEqual(ompProfileChoice(undefined), { kind: 'default' })
})

test('the picker lists profiles on disk plus a current one not created yet', () => {
  assert.deepEqual(ompProfileOptions(['work', 'client'], undefined), ['client', 'work'])
  assert.deepEqual(ompProfileOptions(['work'], 'fresh'), ['fresh', 'work'])
  assert.deepEqual(ompProfileOptions(['work'], 'work'), ['work'])
})

test('a selection saves as the default profile, a name, or nothing valid', () => {
  assert.equal(ompProfileFromChoice({ kind: 'default' }, ''), undefined)
  assert.equal(ompProfileFromChoice({ kind: 'named', name: 'work' }, ''), 'work')
  assert.equal(ompProfileFromChoice({ kind: 'new' }, '  employer-b '), 'employer-b')
  assert.equal(ompProfileFromChoice({ kind: 'new' }, 'default'), undefined)
  assert.equal(ompProfileFromChoice({ kind: 'new' }, 'Employer B'), null)
  assert.equal(ompProfileFromChoice({ kind: 'new' }, ''), null)
})
