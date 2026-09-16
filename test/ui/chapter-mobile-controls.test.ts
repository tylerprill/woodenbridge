import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule, type Rule } from 'postcss';

const stylesheet = postcss.parse(
  readFileSync(
    resolve(process.cwd(), 'components/chapters/chapters.module.css'),
    'utf8',
  ),
);

function responsiveEditorRules(selector: string): Rule[] {
  const matches: Rule[] = [];
  stylesheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    const media = rule.parent as AtRule;
    if (
      media.type === 'atrule' &&
      media.name === 'media' &&
      media.params.includes('(max-width: 760px)') &&
      media.params.includes('(max-height: 480px)') &&
      media.params.includes('(any-pointer: coarse)')
    ) {
      matches.push(rule);
    }
  });
  if (!matches.length) {
    throw new Error(`Missing responsive editor rule for ${selector}`);
  }
  return matches;
}

function declarations(rules: Rule[]) {
  const values: Record<string, string> = {};
  for (const rule of rules) {
    rule.walkDecls((declaration) => {
      values[declaration.prop] = declaration.value;
    });
  }
  return values;
}

describe('Journey editor mobile controls', () => {
  it.each([
    '.sequenceRemove',
    '.sequenceActions button',
    '.sequenceActions button:first-child',
    '.transitionEditor > button',
    '.transitionEditor label > button',
    '.chapterDelete button',
  ])('provides a non-shrinking 44px actual touch target for %s', (selector) => {
    expect(declarations(responsiveEditorRules(selector))).toEqual(
      expect.objectContaining({
        'min-width': '44px',
        'min-height': '44px',
        'flex-shrink': '0',
      }),
    );
  });

  it.each([
    '.editorField :is(input, textarea)',
    '.memorySearch input',
    '.transitionEditor textarea',
  ])(
    'keeps %s at a 16px-equivalent input size on mobile and touch screens',
    (selector) => {
      expect(declarations(responsiveEditorRules(selector))['font-size']).toBe(
        '1rem',
      );
    },
  );
});
