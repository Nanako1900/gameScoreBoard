/** Remove exact occurrences of the active credential before persisting or returning upstream text. */
export function redactAiSecret(text: string, apiKey: string): string {
  return apiKey.length > 0 ? text.split(apiKey).join('[已隐藏]') : text;
}
