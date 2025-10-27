import { ConnectClient } from "@aws-sdk/client-connect";
import { fromIni } from "@aws-sdk/credential-providers";
export const SOURCE_INSTANCE_ID = "4b5d91f9-c7f7-4e83-90c2-e4591769d7c6";
export const TARGET_INSTANCE_ID = "fca80682-f113-4e70-827d-a05bf62445fc";
export const REGION = "us-east-1";
export const PROFILE = "personal";
let sourceClientInstance = null;
let targetClientInstance = null;
export function getSourceClient() {
    if (!sourceClientInstance) {
        sourceClientInstance = new ConnectClient({
            region: REGION,
            credentials: fromIni({ profile: PROFILE })
        });
    }
    return sourceClientInstance;
}
export function getTargetClient() {
    if (!targetClientInstance) {
        targetClientInstance = new ConnectClient({
            region: REGION,
            credentials: fromIni({ profile: PROFILE })
        });
    }
    return targetClientInstance;
}
export function getClient(instanceId) {
    if (instanceId === SOURCE_INSTANCE_ID) {
        return getSourceClient();
    }
    else if (instanceId === TARGET_INSTANCE_ID) {
        return getTargetClient();
    }
    else {
        throw new Error(`Unknown instance ID: ${instanceId}`);
    }
}
//# sourceMappingURL=auth.js.map