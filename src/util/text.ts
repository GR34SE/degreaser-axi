export const decodeUtf8 = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export const isUtf8 = (bytes: Uint8Array) => {
  try {
    decodeUtf8(bytes);
    return true;
  } catch {
    return false;
  }
};

export const nulList = (value: string) => value.split("\0").filter(Boolean);
