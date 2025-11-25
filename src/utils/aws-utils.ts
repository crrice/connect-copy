
import { TagResourceCommand, UntagResourceCommand } from "@aws-sdk/client-connect";

import type { ConnectClient } from "@aws-sdk/client-connect";


export async function updateResourceTags(client: ConnectClient, resourceArn: string, tagsToAdd: Record<string, string>, tagsToRemove: string[]): Promise<void> {

  if (Object.keys(tagsToAdd).length) {
    await client.send(new TagResourceCommand({
      resourceArn: resourceArn,
      tags: tagsToAdd
    }));
  }

  if (tagsToRemove.length) {
    await client.send(new UntagResourceCommand({
      resourceArn: resourceArn,
      tagKeys: tagsToRemove
    }));
  }
}
