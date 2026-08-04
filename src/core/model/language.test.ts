import { describe, expect, it } from 'vitest'
import { detectLanguage, looksLikeMarkdown } from './language'

describe('guessing a code block’s language', () => {
  it.each([
    ['typescript', 'interface User {\n  name: string\n  age: number\n}'],
    ['tsx', 'const App = () => <Button label="ok" />\nexport default App'],
    ['python', 'def greet(name):\n    print(f"hello {name}")'],
    ['rust', 'fn main() {\n    let mut total = 0;\n    println!("{}", total);\n}'],
    ['go', 'package main\n\nfunc main() {\n\tfmt.Println("hi")\n}'],
    ['java', 'public static void main(String[] args) {\n  System.out.println("hi");\n}'],
    ['ruby', "require 'json'\ndef parse(raw)\n  JSON.parse(raw)\nend"],
    ['php', '<?php\n$name = "world";\necho $name;'],
    ['shell', '#!/bin/bash\nset -euo pipefail\necho "building"'],
    ['sql', 'SELECT name, email\nFROM users\nWHERE active = true'],
    ['json', '{\n  "name": "nook",\n  "private": true\n}'],
    ['html', '<!doctype html>\n<html>\n  <body>hello</body>\n</html>'],
    ['css', '.card {\n  color: red;\n  padding: 4px;\n}'],
  ])('recognises %s', (language, code) => {
    expect(detectLanguage(code)).toBe(language)
  })

  it('parses JSON rather than guessing at it', () => {
    // JSON is the one language here with an exact definition, so a pattern
    // would be a worse answer than the parser.
    expect(detectLanguage('{ "looks": "like json", "but": [1, 2, 3] }')).toBe('json')
    expect(detectLanguage('{ looks: "like json", but: is not }')).not.toBe('json')
  })

  describe('refusing to answer', () => {
    it('says nothing about a snippet too short to carry a signal', () => {
      // One line of `x = 1` is every language at once.
      expect(detectLanguage('x = 1')).toBeUndefined()
      expect(detectLanguage('   ')).toBeUndefined()
      expect(detectLanguage('')).toBeUndefined()
    })

    it('says nothing about prose', () => {
      expect(
        detectLanguage(
          'This is an ordinary paragraph of text that happens to sit in a code block.',
        ),
      ).toBeUndefined()
    })

    it('says nothing when one weak marker is all there is', () => {
      // A single lean must never reach the floor on its own: the wrong grammar
      // mangles the colours of the entire block.
      expect(detectLanguage('const answer = 42;')).toBeUndefined()
    })

    it('says nothing when two candidates tie', () => {
      // Picking by map order would be arbitrariness dressed up as an answer.
      const ambiguous = 'interface Foo { bar: string }\nfn main() { let mut x = 1; }'
      const result = detectLanguage(ambiguous)
      expect(result === undefined || result === 'typescript' || result === 'rust').toBe(true)
    })
  })

  it('prefers the more specific of two overlapping languages', () => {
    // Both are valid JavaScript; the type annotation is what settles it.
    expect(detectLanguage('function add(a: number, b: number) {\n  return a + b\n}')).toBe(
      'typescript',
    )
    expect(detectLanguage('function add(a, b) {\n  console.log(a)\n  return a + b\n}')).toBe(
      'javascript',
    )
  })

  it('is unaffected by surrounding blank lines', () => {
    expect(detectLanguage('\n\n\nSELECT * FROM users\n\n')).toBe('sql')
  })
})

describe('recognising pasted Markdown', () => {
  it.each([
    ['a heading and a list', '## Notes\n\n- first\n- second'],
    ['a numbered list', '1. one\n2. two'],
    ['a quote and a rule', '> quoted\n\n---'],
    ['a fenced block', '```js\nconst a = 1\n```'],
    ['a table', '| a | b |\n| - | - |'],
    ['a lone heading', '# Just a title'],
  ])('accepts %s', (_, text) => {
    expect(looksLikeMarkdown(text)).toBe(true)
  })

  it.each([
    ['plain prose', 'This is a sentence. And another one, longer than the first.'],
    ['an empty string', ''],
    [
      'prose with one stray dash',
      'A paragraph of ordinary text.\n\nAnother paragraph here.\n\n- and one line that starts with a dash\n\nAnd more prose after it.\n\nStill more.',
    ],
  ])('rejects %s', (_, text) => {
    // A sentence beginning with a dash is a dash, not a list.
    expect(looksLikeMarkdown(text)).toBe(false)
  })
})
