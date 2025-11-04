import { describe, it } from 'mocha';
import { strict as assert } from 'node:assert';
import { loadPromptGroup, extractGroupVariables } from '../src/ai/prompt-loader.js';

describe('Prompt Group - nofx', () => {
  it('should load the nofx-decision prompt group and expose expected fields', () => {
    const group = loadPromptGroup('nofx');
    assert.ok(group.metadata);
    assert.equal(group.metadata.name, 'nofx');
    assert.ok(typeof group.system === 'string' && group.system.length > 10);
    assert.ok(typeof group.user === 'string' && group.user.length > 10);
  });

  it('should expose and sort variables across system and user templates', () => {
    const group = loadPromptGroup('nofx');
    const vars = extractGroupVariables(group);
    // Expect some core variables from default context to be present
    const mustHave = [
      'tradableCoins',
      'maxPositions',
      'maxRiskPerTrade',
      'minLeverage',
      'maxLeverage',
      'defaultStopLoss',
      'elapsedMinutes',
      'currentTime',
      'invokeCount',
      'candlesTA',
      'accountInfo',
      'positionsInfo',
    ];
    for (const v of mustHave) {
      assert.ok(vars.all.includes(v), `missing variable: ${v}`);
    }
  });
});
