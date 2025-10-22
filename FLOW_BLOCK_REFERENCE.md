# Amazon Connect Flow Block Reference

This document catalogs all Amazon Connect flow blocks that contain ARN or resource ID references, based on AWS documentation and actual flow analysis.

## Block Name Mapping (Admin Guide → JSON Type)

| Admin Guide Name | JSON Type Field | Contains ARN/ID |
|-----------------|-----------------|-----------------|
| Amazon Q in Connect | `CreateWisdomSession` | Yes - Q domain ARN |
| Authenticate Customer | `AuthenticateParticipant` | Yes - Cognito User Pool & App Client |
| Cases | `CreateCase` | Yes - Case Template ID, Customer Profile ARN |
| Get customer input | `GetParticipantInput` | Yes - Lex bot ARN (when configured) |
| AWS Lambda function | `InvokeLambdaFunction` | Yes - Lambda function ARN |
| Invoke module | `InvokeFlowModule` | Yes - Flow Module ARN/ID |
| Play prompt | `MessageParticipant` | Yes - Prompt ARN/ID |
| Send message | `StartOutboundEmailContact` | Yes - Phone number ARN, Flow ARN |
| Set customer queue flow | `UpdateContactEventHooks` | Yes - Flow ARN (CustomerQueue field) |
| Set disconnect flow | `UpdateContactEventHooks` | Yes - Flow ARN (DisconnectFlow field) |
| Set whisper flow | `UpdateContactEventHooks` | Yes - Flow ARN (AgentWhisper field) |
| Set working queue | `UpdateContactTargetQueue` | Yes - Queue ARN/ID |
| Show view | `ShowView` | Yes - View resource ARN |
| Transfer to flow | `TransferToFlow` | Yes - Flow ARN/ID |
| Transfer to queue | `TransferContactToQueue` | Yes - Queue ARN/ID |

## ARN-Containing Blocks by Flow Type

### All Flows (any flow type)
- Cases (`CreateCase`)
- Set disconnect flow (`UpdateContactEventHooks`)

### Inbound Flow
All 15 ARN-containing blocks are supported in Inbound flows.

### Customer Queue Flow
- Amazon Q in Connect
- Get customer input
- AWS Lambda function
- Play prompt
- Send message
- Transfer to queue

### Customer Hold Flow
- AWS Lambda function
- Send message

### Customer Whisper Flow
- AWS Lambda function
- Play prompt
- Send message

### Outbound Whisper Flow
- Amazon Q in Connect
- Get customer input
- Play prompt
- Send message

### Agent Hold Flow
- AWS Lambda function
- Send message

### Agent Whisper Flow
- AWS Lambda function
- Send message

### Transfer to Agent Flow
- Amazon Q in Connect
- Get customer input
- AWS Lambda function
- Play prompt
- Send message
- Set customer queue flow
- Set whisper flow
- Set working queue
- Transfer to flow
- Transfer to queue

### Transfer to Queue Flow
- Amazon Q in Connect
- Get customer input
- AWS Lambda function
- Play prompt
- Send message
- Set customer queue flow
- Set whisper flow
- Set working queue
- Transfer to flow
- Transfer to queue

### Disconnect Flow
- Send message

### Inbound Flow Only (3 blocks)
- Authenticate Customer (`AuthenticateParticipant`)
- Invoke module (`InvokeFlowModule`)
- Show view (`ShowView`)

## Known ARN/ID Field Names

Based on actual flow analysis and documentation:

### ✅ Confirmed from Flow Analysis:

1. **InvokeLambdaFunction** (AWS Lambda function):
   - `Parameters.LambdaFunctionARN` - Lambda function ARN

2. **CreateCase** (Cases):
   - `Parameters.CaseTemplateId` - Case template ID (not ARN)

3. **GetParticipantInput** (Get customer input):
   - `Parameters.PromptId` - Prompt ARN (when playing audio)
   - Lex bot field - UNKNOWN (not configured in test flow)

4. **MessageParticipant** (Play prompt):
   - `Parameters.PromptId` - Prompt ARN
   - `Parameters.Media.Uri` - S3 URI for audio files
   - `Parameters.SSML` - Text-to-speech (no ARN)

5. **UpdateContactEventHooks** (Set customer queue flow / Set disconnect flow / Set whisper flow):
   - `Parameters.EventHooks.CustomerQueue` - Flow ARN
   - `Parameters.EventHooks.CustomerRemaining` - Flow ARN
   - `Parameters.EventHooks.AgentWhisper` - Flow ARN
   - `Parameters.EventHooks.DisconnectFlow` - Flow ARN (documented, not in test flow)

6. **UpdateContactTargetQueue** (Set working queue):
   - `Parameters.QueueId` - Queue ARN

7. **ShowView** (Show view):
   - `Parameters.ViewResource.Id` - View ARN (despite field name "Id")

8. **TransferToFlow** (Transfer to flow):
   - `Parameters.ContactFlowId` - Flow ARN

### ⚠️ High Confidence (inferred from patterns):

9. **TransferContactToQueue** (Transfer to queue):
   - `Parameters.QueueId` - Queue ARN (not configured, but same pattern as UpdateContactTargetQueue)

10. **InvokeFlowModule** (Invoke module):
    - `Parameters.ContactFlowModuleId` or `Parameters.ModuleId` - Module ARN (not configured in test flow)

### ❌ Unknown (not configured in test flows):

11. **CreateWisdomSession** (Amazon Q in Connect):
    - Field name unknown - likely `Parameters.WisdomDomainArn` or similar

12. **AuthenticateParticipant** (Authenticate Customer):
    - `Parameters.CognitoConfiguration.UserPoolId` - User Pool ARN (likely)
    - `Parameters.CognitoConfiguration.AppClientId` - App Client ID (likely)

13. **StartOutboundEmailContact** (Send message):
    - Has email addresses but phone number ARN field unknown
    - Flow ARN reference field unknown

## Flow Structure Overview

### Flow JSON Format
```json
{
  "Version": "2019-10-30",
  "StartAction": "action-uuid",
  "Metadata": {
    "entryPointPosition": { "x": 0, "y": 0 },
    "ActionMetadata": { /* UI metadata */ }
  },
  "Actions": [
    {
      "Identifier": "unique-uuid",
      "Type": "ActionTypeName",
      "Parameters": { /* ARNs and config */ },
      "Transitions": { /* Next actions */ }
    }
  ]
}
```

### Action Structure
Each action has:
- **Identifier**: Unique UUID for the action
- **Type**: The action type (maps to Admin Guide block name)
- **Parameters**: Configuration including ARNs/IDs
- **Transitions**: Next actions (Success, Error branches)

### ARN Detection Strategy
1. Search for known field names in Parameters
2. Look for strings matching ARN pattern: `arn:aws:connect:...`
3. Some blocks use dynamic references: `$.Attributes.fieldName`

## Important Notes

### AWS Naming Inconsistency
**Critical Finding:** AWS inconsistently names ARN fields. Many fields ending in `Id` actually contain full ARNs:
- `QueueId` → Contains full Queue ARN
- `ContactFlowId` → Contains full Flow ARN
- `PromptId` → Contains full Prompt ARN
- `ViewResource.Id` → Contains full View ARN
- Only `LambdaFunctionARN` uses the correct naming

**Implication:** When traversing flows, treat any field ending in `*Id`, `*ARN`, or `*Arn` as potentially containing an ARN.

### Other Notes
- Empty string `""` or empty object `{}` means the field exists but is not configured
- Some blocks support dynamic values using JSONPath syntax (e.g., `$.Attributes.variableName`)
- ARN format varies by resource type but follows: `arn:aws:service:region:account:resource-type/resource-id`
- S3 URIs use format: `s3://bucket-name/path/to/file` (not ARNs)
