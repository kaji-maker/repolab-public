/** Controller-authored observations. Expected values never enter the source child. */
export type CrossCase = {
  id: string;
  program: string;
  input: any;
  expected: any;
};
const equal = "return require('./')(input.left, input.right);";
const clone = `const source = input.values.slice();
Object.assign(source, input.properties);
const fn = require('./')(input.options);
const result = fn(source);
return { length: result.length, keys: Object.keys(result), values: Array.from(result),
  properties: Object.fromEntries(Object.keys(input.properties).map(k => [k, result[k]])),
  separate: result !== source && source.every((v,i) => !v || typeof v !== 'object' || result[i] !== v) };`;
const stringify = `let value = input.value;
for (const path of input.boxes) {
  if (!path.length) value = new String(value);
  else { let node = value; for (const key of path.slice(0,-1)) node = node[key];
    const key = path[path.length-1]; node[key] = new String(node[key]); }
}
return require('./')(value);`;
export function crossCases(name: string, independent: boolean): CrossCase[] {
  if (name === "fast-deep-equal") {
    const examples = independent
      ? [null, 0, false, "", "state", [1, 2], { nested: "data" }]
      : ["In Progress"];
    return [
      ...examples.flatMap((value, i) => [
        {
          id: "equal-" + i,
          program: equal,
          input: {
            left: { tag: "x", toString: value },
            right: { tag: "x", toString: value },
          },
          expected: true,
        },
        {
          id: "unequal-" + i,
          program: equal,
          input: {
            left: { tag: "x", toString: value },
            right: { tag: "y", toString: value },
          },
          expected: false,
        },
      ]),
      {
        id: "ordinary-control",
        program: equal,
        input: { left: { a: [1, 2] }, right: { a: [1, 2] } },
        expected: true,
      },
      ...(independent
        ? [
            {
              id: "different-field",
              program: equal,
              input: { left: { toString: "a" }, right: { toString: "b" } },
              expected: false,
            },
            {
              id: "nested-field",
              program: equal,
              input: {
                left: [{ toString: null }],
                right: [{ toString: null }],
              },
              expected: true,
            },
          ]
        : []),
    ];
  }
  if (name === "rfdc") {
    const examples = independent
      ? [
          { values: [], properties: { note: "empty" } },
          { values: [1, 2, 3], properties: { label: "abc", count: 9 } },
          { values: [{ x: 1 }], properties: { extra: { y: [2] } } },
        ]
      : [{ values: [1], properties: { foo: "bar" } }];
    const options = independent
      ? [{}, { proto: true }, { circles: true }, { proto: true, circles: true }]
      : [{}];
    return examples.flatMap((v, i) =>
      options.map((o, j) => ({
        id: `array-${i}-${j}`,
        program: clone,
        input: { ...v, options: o },
        expected: {
          length: v.values.length,
          keys: [
            ...v.values.map((_, k) => String(k)),
            ...Object.keys(v.properties),
          ],
          values: v.values,
          properties: v.properties,
          separate: true,
        },
      })),
    );
  }
  if (name === "fast-json-stable-stringify") {
    const examples = independent
      ? [
          { value: "", boxes: [[]] },
          { value: "雪 🏔", boxes: [[]] },
          { value: { a: "hello", b: "world" }, boxes: [["a"], ["b"]] },
          { value: ["x", "y"], boxes: [[0], [1]] },
          {
            value: { a: ["x", { b: 'escaped " \\' }] },
            boxes: [
              ["a", 0],
              ["a", 1, "b"],
            ],
          },
          { value: { a: "123", b: 7 }, boxes: [["a"]] },
        ]
      : [
          { value: { a: "hello" }, boxes: [["a"]] },
          { value: "plain", boxes: [] },
        ];
    return examples.map((v, i) => ({
      id: "string-" + i,
      program: stringify,
      input: v,
      expected: JSON.stringify(v.value),
    }));
  }
  throw Error("Unsupported observation task");
}
