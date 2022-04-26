import * as assert from 'assert'
import * as ext from '../../extension'


suite('Indentation', () => {
    test('functions', () => {
        assert.strictEqual(ext.increaseIndentPattern.test('function f()'), true)
    })

    test('for loops', () => {
        // Should indent next line
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:5'), true)
        assert.strictEqual(ext.increaseIndentPattern.test('  for i = 1:5'), true)
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:inds[end]'), true)
        assert.strictEqual(ext.increaseIndentPattern.test('for i in inds[2:end]'), true)
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:inds[end ]'), true)
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:inds[end] '), true)
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:inds[end]  # comment'), true)

        // Should not indent next line
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:5; end'), false)
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:inds[end]; end'), false)
        assert.strictEqual(ext.increaseIndentPattern.test('for i in inds[2:end]; end'), false)
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:5; end '), false)
        assert.strictEqual(ext.increaseIndentPattern.test('for i = 1:5; end  # comment'), false)
        assert.strictEqual(ext.increaseIndentPattern.test('  for i = 1:5; end  # comment'), false)
    })

    test('end', () => {
        assert.strictEqual(ext.decreaseIndentPattern.test('    end'), true)
    })
})
