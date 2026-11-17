import { expect, test } from 'vitest';
import * as fontisan from 'fontisan-ts-placeholder';

test('loads the placeholder package entry point', () => {
  expect(Object.keys(fontisan)).toEqual([]);
});
