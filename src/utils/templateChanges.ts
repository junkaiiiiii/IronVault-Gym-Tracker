export const normalizeTemplateVariantForComparison = (value: any): string => {
  const variant = String(value || "").trim();
  return variant.toLowerCase() === "normal" ? "" : variant;
};

export const getTemplateVariantForStorage = (
  value: any,
  hasVariantOptions: boolean,
): string | undefined => {
  if (!hasVariantOptions) return undefined;
  return String(value || "").trim() || "Normal";
};

export const getTemplateVariantLabel = (
  value: any,
  hasVariantOptions: boolean,
): string =>
  normalizeTemplateVariantForComparison(value) ||
  (hasVariantOptions ? "Normal" : "");
