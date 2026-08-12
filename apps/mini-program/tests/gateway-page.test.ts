import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

let gatewayDefinition: any;
(globalThis as any).Page = (value: any) => { gatewayDefinition = value; };
await import('../pages/gateway/index.ts');

function makePage(ready = false) {
  return {
    ...gatewayDefinition,
    data: { ...gatewayDefinition.data, ready },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update); },
  };
}

test('gateway exposes exactly two side-by-side activity choices', () => {
  const markup = readFileSync(new URL('../pages/gateway/index.wxml', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../pages/gateway/index.wxss', import.meta.url), 'utf8');
  assert.equal((markup.match(/<button class="gateway-action/g) || []).length, 2);
  assert.match(markup, />参加活动</);
  assert.match(markup, />发布活动</);
  assert.match(styles, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('gateway choices wait for loading and then route to their target tabs', () => {
  const targets: string[] = [];
  (globalThis as any).wx = { switchTab: ({ url }: { url: string }) => targets.push(url) };
  const page = makePage(false);
  page.joinActivity();
  page.publishActivity();
  assert.deepEqual(targets, []);
  page.data.ready = true;
  page.joinActivity();
  page.publishActivity();
  assert.deepEqual(targets, ['/pages/events/index', '/pages/publish/index']);
});
