export const deepMerge = <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  target: T,
  ...sources: T[]
): T => {
  if (!sources.length) {
    return target;
  }
  const source = sources.shift();
  if (source === undefined) {
    return target;
  }

  if (isMergebleObject(target) && isMergebleObject(source)) {
    (Object.keys(source) as Array<keyof typeof source>).forEach(
      function (key) {
        if (isMergebleObject(source[key])) {
          if (!target[key]) {
            // deno-lint-ignore no-explicit-any
            (target as any)[key] = {};
          }
          // deno-lint-ignore no-explicit-any
          deepMerge((target as any)[key], source[key]);
        } else {
          target[key] = source[key];
        }
      },
    );
  }

  return deepMerge(target, ...sources);
};

const isObject = (item: unknown): boolean => {
  return item !== null && typeof item === "object";
};

const isMergebleObject = (item: unknown): boolean => {
  return isObject(item) && !Array.isArray(item);
};
