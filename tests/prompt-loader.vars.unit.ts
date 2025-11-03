import { describe, it } from 'mocha';
import { strict as assert } from 'node:assert';
import {
  extractTemplateVariables,
  renderTemplate,
  extractGroupVariables,
  type PromptGroup,
} from '../src/ai/prompt-loader.js';

describe('Prompt Loader - Variable Extraction & Rendering', () => {
  it('extractTemplateVariables should find unique, sorted variables', () => {
    const tpl = 'A {{x}} and {{y}} and {{x}} again, then {{z1}}';
    const vars = extractTemplateVariables(tpl);
    assert.deepEqual(vars, ['x', 'y', 'z1']);
  });

  it('renderTemplate should replace variables and leave missing as empty', () => {
    const tpl = 'Hello {{name}}, today is {{day}}. Missing: {{unknown}}!';
    const rendered = renderTemplate(tpl, { name: 'Alice', day: 'Monday' });
    assert.equal(rendered, 'Hello Alice, today is Monday. Missing: !');
  });

  it('extractGroupVariables should merge and de-duplicate across system/user', () => {
    const group: PromptGroup = {
      metadata: { name: 'test' },
      system: 'S uses {{a}} and {{b}}',
      user: 'U uses {{b}} and {{c}}',
    } as any;
    const res = extractGroupVariables(group);
    assert.deepEqual(res.system, ['a', 'b']);
    assert.deepEqual(res.user, ['b', 'c']);
    assert.deepEqual(res.all, ['a', 'b', 'c']);
  });
});
