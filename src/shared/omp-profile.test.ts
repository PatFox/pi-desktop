import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isValidOmpProfileName, normalizeOmpProfile, ompProfileArgs, ompProfileArgument } from './omp-profile'

test('accepts the names OMP accepts', () => {
  for (const name of ['work', 'employer-a', 'client.2', 'a_b', '0', 'a'.repeat(64)]) {
    assert.equal(isValidOmpProfileName(name), true, name)
  }
})

test('rejects names OMP refuses', () => {
  for (const name of [
    '',
    'Work', // OMP profile names are lower-case
    '-work', // would parse as a flag
    '.hidden',
    '..',
    'trailing.',
    'a/b',
    'a\\b',
    'with space',
    'a'.repeat(65),
  ]) {
    assert.equal(isValidOmpProfileName(name), false, name)
  }
})

test('rejects Windows reserved device names on every platform', () => {
  for (const name of ['con', 'nul', 'com1', 'lpt9', 'con.txt', 'aux.profile']) {
    assert.equal(isValidOmpProfileName(name), false, name)
  }
  // A reserved word inside a longer name is fine.
  assert.equal(isValidOmpProfileName('console'), true)
})

test('normalize maps every spelling of the default profile to undefined', () => {
  assert.equal(normalizeOmpProfile(undefined), undefined)
  assert.equal(normalizeOmpProfile(null), undefined)
  assert.equal(normalizeOmpProfile(''), undefined)
  assert.equal(normalizeOmpProfile('   '), undefined)
  assert.equal(normalizeOmpProfile('default'), undefined)
})

test('normalize trims a valid name and flags everything else as invalid', () => {
  assert.equal(normalizeOmpProfile(' work '), 'work')
  assert.equal(normalizeOmpProfile('Work'), null)
  assert.equal(normalizeOmpProfile('../escape'), null)
  assert.equal(normalizeOmpProfile(42), null)
  assert.equal(normalizeOmpProfile({ name: 'work' }), null)
})

test('the CLI argument names the default profile explicitly', () => {
  // An explicit `--profile default` beats an OMP_PROFILE inherited from the
  // app's environment, so a default-profile workspace really is the default.
  assert.equal(ompProfileArgument(undefined), 'default')
  assert.equal(ompProfileArgument('work'), 'work')
})

test('only OMP invocations are pinned to a profile', () => {
  assert.deepEqual(ompProfileArgs('omp', 'work'), ['--profile', 'work'])
  assert.deepEqual(ompProfileArgs('omp', undefined), ['--profile', 'default'])
  assert.deepEqual(ompProfileArgs('pi', 'work'), [])
  assert.deepEqual(ompProfileArgs(null, 'work'), [])
})
