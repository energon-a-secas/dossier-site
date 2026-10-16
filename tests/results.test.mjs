/**
 * The tests block. A state outside the enum used to fall back to "passed":
 * the row went green, the screen-reader word said "passed", and the failure
 * output the author included was hidden because the row "passed".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { blockHtml } from '../js/render/index.js';

const row = (item) => blockHtml({ type: 'tests', items: [item] }, {});

test('an unknown test state renders as unknown, never as passed', () => {
  const html = row({ name: 'limiter', state: 'timedout', message: 'took 31 s' });
  assert.ok(html.includes('test-state--unknown'), html);
  assert.ok(!html.includes('test-state--passed'), 'an unknown state was painted as passed');
  assert.ok(!html.includes(', passed'), 'the state word said passed');
  assert.ok(html.includes('unknown state “timedout”'), 'the raw value is not shown');
  assert.ok(html.includes('took 31 s'), 'the message of an unknown state was hidden');
});

test('the raw state value is escaped, and a missing state says so', () => {
  const hostile = row({ name: 'n', state: '<img src=x onerror=alert(1)>' });
  assert.ok(hostile.includes('test-state--unknown'));
  assert.ok(!hostile.includes('<img'), 'the raw state reached the page as markup');
  assert.ok(hostile.includes('&lt;img'), 'the raw state is not shown escaped');

  for (const state of [undefined, null, '', '   ']) {
    const html = row({ name: 'n', state });
    assert.ok(html.includes('test-state--unknown'), `state ${JSON.stringify(state)}`);
    assert.ok(html.includes('state not given'), `state ${JSON.stringify(state)}`);
  }
  const object = row({ name: 'n', state: { nested: true } });
  assert.ok(object.includes(', unknown state<'), 'an object state is not described as unknown');
  assert.ok(!object.includes('[object Object]'));
});

test('a long raw state is shortened, not printed whole', () => {
  const html = row({ name: 'n', state: 'x'.repeat(200) });
  assert.ok(html.includes(`“${'x'.repeat(39)}…”`));
});

test('the message shows whenever the author gave one, whatever the state', () => {
  for (const state of ['passed', 'failed', 'skipped', 'flaky', 'errored', 'mystery', undefined]) {
    const html = row({ name: 'n', state, message: 'retried once <b>then</b> passed' });
    assert.ok(html.includes('class="test-message"'), `no message for state ${state}`);
    assert.ok(html.includes('retried once &lt;b&gt;then&lt;/b&gt; passed'), `message not escaped for state ${state}`);
  }
  assert.ok(!row({ name: 'n', state: 'failed', message: '  ' }).includes('test-message'), 'an empty message drew an empty box');
  assert.ok(!row({ name: 'n', state: 'failed' }).includes('test-message'));
});

test('known states keep their own class and word', () => {
  for (const state of ['passed', 'failed', 'skipped', 'flaky', 'errored']) {
    const html = row({ name: 'n', state });
    assert.ok(html.includes(`test-state--${state}`), state);
    assert.ok(html.includes(`, ${state}</span>`), state);
  }
});
