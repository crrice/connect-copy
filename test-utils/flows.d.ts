import type { ContactFlowType, ContactFlowStatus, ContactFlow } from "@aws-sdk/client-connect";
export declare function createTestFlow(instanceId: string, name: string, status?: ContactFlowStatus, type?: ContactFlowType, description?: string): Promise<{
    id: string;
    arn: string;
}>;
export declare function deleteTestFlow(instanceId: string, flowId: string): Promise<void>;
export declare function getFlowDetails(instanceId: string, flowId: string, useSavedSuffix?: boolean): Promise<ContactFlow>;
export declare function getFlowStatus(instanceId: string, flowId: string): Promise<ContactFlowStatus>;
export declare function flowExists(instanceId: string, flowName: string): Promise<boolean>;
export interface FlowCleanup {
    instanceId: string;
    flowId: string;
    flowName: string;
}
export declare function registerForCleanup(instanceId: string, flowId: string, flowName: string): void;
export declare function cleanupAllFlows(): Promise<void>;
//# sourceMappingURL=flows.d.ts.map