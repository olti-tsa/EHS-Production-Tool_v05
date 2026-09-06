import assert from "node:assert/strict";
import test from "node:test";
import { en } from "./en";
import { no } from "./no";

const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test("English and Norwegian dictionaries have exact key parity", () => {
  assert.deepEqual(Object.keys(no).sort(), Object.keys(en).sort());
});

test("English and Norwegian interpolation placeholders match", () => {
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    assert.deepEqual(
      placeholders(no[key]),
      placeholders(en[key]),
      `Placeholder mismatch for ${key}`,
    );
  }
});