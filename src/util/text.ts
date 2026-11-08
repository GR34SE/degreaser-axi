export { isUtf8 } from "node:buffer";

export const nulList = (value: string) => value.split("\0").filter(Boolean);
