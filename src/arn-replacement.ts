
export function replaceArnsInContent(contentString: string, arnMappings: Map<string, string>): string {
  let updatedContent = contentString;

  for (const [sourceArn, targetArn] of arnMappings) {
    updatedContent = updatedContent.replaceAll(sourceArn, targetArn);
  }

  return updatedContent;
}
