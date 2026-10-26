export function freshNativeSignature(result: any, runner: "tap" | "ava") {
  if (result.exitCode !== 0 || result.signal || result.error)
    throw Error("Unchanged native command failed");
  const text = (String(result.stdout) + "\n" + String(result.stderr)).replace(
    /\u001b\[[0-9;]*[A-Za-z]/g,
    "",
  );
  const collect = (pattern: RegExp) =>
    [...text.matchAll(pattern)].map((m) => Number(m[1]));
  if (runner === "ava") {
    const passed = collect(/\b(\d+) tests? passed\b/g),
      skipped = collect(/\b(\d+) tests? skipped\b/g);
    if (
      !passed.length ||
      passed.some((n) => n <= 0) ||
      collect(/\b(\d+) tests? failed\b/g).some((n) => n > 0)
    )
      throw Error("AVA inventory is empty or failed");
    return { runner, passed, skipped };
  }
  const tests = collect(/#\s*tests\s+(\d+)/g),
    passed = collect(/#\s*pass\s+(\d+)/g),
    failed = collect(/#\s*fail\s+(\d+)/g);
  if (
    !tests.length ||
    !passed.length ||
    tests.some((n) => n <= 0) ||
    passed.some((n) => n <= 0) ||
    failed.some((n) => n > 0)
  )
    throw Error("TAP inventory is empty or failed");
  return { runner, tests, passed, failed };
}
