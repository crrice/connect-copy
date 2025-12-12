
import type { ArnPattern } from "./validation.js";


const EXTERNAL_ARN_PATTERN = /arn:aws:(lambda|lex):[a-z0-9-]*:\d*:[^\s,"]+|s3:\/\/[^\s,"]+/g;


export function replaceArnsInContent(contentString: string, arnMappings: Map<string, string>): string {
  let updatedContent = contentString;

  for (const [sourceArn, targetArn] of arnMappings) {
    updatedContent = updatedContent.replaceAll(sourceArn, targetArn);
  }

  return updatedContent;
}


export function extractExternalArns(content: string): string[] {
  const matches = content.matchAll(EXTERNAL_ARN_PATTERN);
  return [...new Set([...matches].map(m => m[0]))];
}


function extractTypeAndName(arn: string): { prefix: string; typeName: string } | undefined {
  // S3: use whole thing
  if (arn.startsWith("s3://")) {
    return { prefix: "", typeName: arn };
  }

  // Lambda: arn:aws:lambda:region:account:function:name[:qualifier]
  const [, lambdaPrefix, lambdaTypeName] = arn.match(/^(arn:aws:lambda:[a-z0-9-]+:\d+:)(function:.+)$/) ?? [];
  if (lambdaPrefix && lambdaTypeName) {
    return { prefix: lambdaPrefix, typeName: lambdaTypeName };
  }

  // Lex: arn:aws:lex:region:account:bot:name or bot-alias:name/alias
  const [, lexPrefix, lexTypeName] = arn.match(/^(arn:aws:lex:[a-z0-9-]+:\d+:)(bot.+)$/) ?? [];
  if (lexPrefix && lexTypeName) {
    return { prefix: lexPrefix, typeName: lexTypeName };
  }

  return undefined;
}


export function transformArn(
  sourceArn: string,
  arnMappings?: Record<string, string>,
  arnPatterns?: ArnPattern[]
): string | undefined {
  // Check explicit mappings first (full ARN to full ARN)
  if (arnMappings?.[sourceArn]) {
    return arnMappings[sourceArn];
  }

  // Check regex patterns against type:name portion
  if (arnPatterns) {
    const extracted = extractTypeAndName(sourceArn);
    if (!extracted) return undefined;

    for (const pattern of arnPatterns) {
      const regex = new RegExp(pattern.match);
      if (regex.test(extracted.typeName)) {
        const newTypeName = extracted.typeName.replace(regex, pattern.replace);
        return extracted.prefix + newTypeName;
      }
    }
  }

  return undefined;
}


export function buildExternalArnMappings(
  contents: string[],
  arnMappings?: Record<string, string>,
  arnPatterns?: ArnPattern[]
): Map<string, string> {
  const mappings = new Map<string, string>();

  if (!arnMappings && !arnPatterns) return mappings;

  for (const content of contents) {
    const externalArns = extractExternalArns(content);

    for (const arn of externalArns) {
      if (mappings.has(arn)) continue;

      const targetArn = transformArn(arn, arnMappings, arnPatterns);
      if (targetArn && targetArn !== arn) {
        mappings.set(arn, targetArn);
      }
    }
  }

  return mappings;
}
