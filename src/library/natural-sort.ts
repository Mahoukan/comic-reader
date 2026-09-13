const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function naturalCompare(first: string, second: string): number {
  return collator.compare(first, second);
}

export function naturalCompareFilenames(first: string, second: string): number {
  // Compare stems first so an extension does not put Chapter 10.5 before Chapter 10.
  const stem = (name: string): string => name.replace(/\.[^.]*$/, "");
  return naturalCompare(stem(first), stem(second)) || naturalCompare(first, second);
}
