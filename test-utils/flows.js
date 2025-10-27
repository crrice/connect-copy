import { DeleteContactFlowCommand, DescribeContactFlowCommand } from "@aws-sdk/client-connect";
import { createContactFlow } from "../src/connect/operations.js";
import { describeContactFlow } from "../src/connect/flows.js";
import { getClient } from "./auth.js";
export async function createTestFlow(instanceId, name, status = "SAVED", type = "CONTACT_FLOW", description) {
    const client = getClient(instanceId);
    const stubContent = JSON.stringify({
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
    return await createContactFlow(client, instanceId, name, stubContent, type, description, undefined, status);
}
export async function deleteTestFlow(instanceId, flowId) {
    const client = getClient(instanceId);
    await client.send(new DeleteContactFlowCommand({
        InstanceId: instanceId,
        ContactFlowId: flowId
    }));
}
export async function getFlowDetails(instanceId, flowId, useSavedSuffix = false) {
    const client = getClient(instanceId);
    const effectiveFlowId = useSavedSuffix ? flowId + ":$SAVED" : flowId;
    return await describeContactFlow(client, instanceId, effectiveFlowId);
}
export async function getFlowStatus(instanceId, flowId) {
    const flow = await getFlowDetails(instanceId, flowId);
    return flow.Status;
}
export async function flowExists(instanceId, flowName) {
    const client = getClient(instanceId);
    try {
        const { ContactFlowSummaryList } = await client.send(new DescribeContactFlowCommand({
            InstanceId: instanceId,
            ContactFlowId: flowName
        }));
        return true;
    }
    catch (error) {
        if (error.name === "ResourceNotFoundException") {
            return false;
        }
        throw error;
    }
}
const cleanupRegistry = [];
export function registerForCleanup(instanceId, flowId, flowName) {
    cleanupRegistry.push({ instanceId, flowId, flowName });
}
export async function cleanupAllFlows() {
    console.log(`\nCleaning up ${cleanupRegistry.length} test flows...`);
    for (const flow of cleanupRegistry) {
        try {
            await deleteTestFlow(flow.instanceId, flow.flowId);
            console.log(`  ✓ Deleted: ${flow.flowName}`);
        }
        catch (error) {
            console.log(`  ✗ Failed to delete ${flow.flowName}: ${error.message}`);
        }
    }
    cleanupRegistry.length = 0;
    console.log("Cleanup complete\n");
}
//# sourceMappingURL=flows.js.map