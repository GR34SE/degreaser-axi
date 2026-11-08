export const shellQuote = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`;

export const commandArgument = (value: string) =>
  /^[a-zA-Z0-9_./,:=-]+$/.test(value) ? value : shellQuote(value);
