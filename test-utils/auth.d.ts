import { ConnectClient } from "@aws-sdk/client-connect";
export declare const SOURCE_INSTANCE_ID = "4b5d91f9-c7f7-4e83-90c2-e4591769d7c6";
export declare const TARGET_INSTANCE_ID = "fca80682-f113-4e70-827d-a05bf62445fc";
export declare const REGION = "us-east-1";
export declare const PROFILE = "personal";
export declare function getSourceClient(): ConnectClient;
export declare function getTargetClient(): ConnectClient;
export declare function getClient(instanceId: string): ConnectClient;
//# sourceMappingURL=auth.d.ts.map