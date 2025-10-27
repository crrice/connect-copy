
export function generateStubContent(): string {
  return JSON.stringify({
    "Version": "2019-10-30",
    "StartAction": "disconnect-1",
    "Metadata": {},
    "Actions": [{
      "Identifier": "disconnect-1",
      "Type": "DisconnectParticipant",
      "Parameters": {},
      "Transitions": {}
    }]
  });
}


export function generateFlowContent(entryPoint: { x: number; y: number }): string {
  return JSON.stringify({
    "Version": "2019-10-30",
    "StartAction": "disconnect-1",
    "Metadata": {
      "entryPointPosition": entryPoint,
      "ActionMetadata": {
        "disconnect-1": {
          "position": { "x": 100, "y": 100 }
        }
      }
    },
    "Actions": [{
      "Identifier": "disconnect-1",
      "Type": "DisconnectParticipant",
      "Parameters": {},
      "Transitions": {}
    }]
  });
}


export function modifyEntryPoint(content: string, newX: number, newY: number): string {
  const parsed = JSON.parse(content);

  if (!parsed.Metadata) {
    parsed.Metadata = {};
  }

  parsed.Metadata.entryPointPosition = { x: newX, y: newY };

  return JSON.stringify(parsed);
}


export function getEntryPoint(content: string): { x: number; y: number } | null {
  const parsed = JSON.parse(content);
  return parsed.Metadata?.entryPointPosition || null;
}
