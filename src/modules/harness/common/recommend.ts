export const cheapModelRank = (model: string) => {
  if (!model.includes("-")) return undefined;
  const luna = /(?:^|[-/])luna(?:-|$)/i.test(model) && !/high/i.test(model);
  return luna ||
    /(?:^|[-/])(haiku|mini|composer)(?:-|$)/i.test(model) ||
    /(?:^|[-/])(?:cursor-)?grok-[\d.]+-low(?:-fast)?(?:$|[^\w])/i.test(model)
    ? 2
    : undefined;
};
