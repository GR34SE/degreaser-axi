export { isUtf8 } from "node:buffer";

export const nulList = (value: string) => value.split("\0").filter(Boolean);

export const compareText = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;
