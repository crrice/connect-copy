
import { ConnectClient } from "@aws-sdk/client-connect";
import { fromIni } from "@aws-sdk/credential-providers";


export function createConnectClient(region: string, profile: string) {
  return new ConnectClient({
    region,
    credentials: fromIni({ profile })
  });
}
