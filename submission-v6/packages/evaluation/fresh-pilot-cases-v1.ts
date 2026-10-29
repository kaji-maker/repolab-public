import { readFileSync } from "node:fs";
export function crossCases(name: string, independent: boolean): any[] {
  if (!["minimist", "camelcase", "fastify-deepmerge"].includes(name))
    throw Error("Task outside fresh selection");
  return JSON.parse(
    readFileSync(
      "repositories/fresh-pilot-v1/" +
        name +
        "/" +
        (independent ? "independent" : "public") +
        "-cases.json",
      "utf8",
    ),
  );
}
