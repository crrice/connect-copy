import type { ContactFlowStatus } from "@aws-sdk/client-connect";
export declare function assertFlowStatus(instanceId: string, flowId: string, expectedStatus: ContactFlowStatus, label?: string): Promise<void>;
export declare function assertContentMatches(instanceId: string, flowId: string, expectedContent: string, useSavedSuffix?: boolean, label?: string): Promise<void>;
export declare function assertEntryPoint(instanceId: string, flowId: string, expectedX: number, expectedY: number, useSavedSuffix?: boolean, label?: string): Promise<void>;
export declare function assertDescriptionEquals(instanceId: string, flowId: string, expectedDescription: string | undefined, label?: string): Promise<void>;
export declare function assertTagsEqual(instanceId: string, flowId: string, expectedTags: Record<string, string> | undefined, label?: string): Promise<void>;
export declare function assertDraftExists(instanceId: string, flowId: string, shouldExist?: boolean, label?: string): Promise<void>;
export declare function updateFlowContent(instanceId: string, flowId: string, content: string, useSavedSuffix?: boolean): Promise<void>;
//# sourceMappingURL=assertions.d.ts.map