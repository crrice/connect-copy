
/**
 * Comprehensive mapping of Amazon Connect flow action types to their ARN-containing fields.
 * Based on AWS documentation and actual flow analysis.
 *
 * Note: AWS inconsistently names ARN fields - many fields ending in "Id" actually contain ARNs.
 */

export interface ArnFieldPath {
  /** JSON path to the field within Parameters (e.g., "LambdaFunctionARN" or "EventHooks.CustomerQueue") */
  path: string;
  /** Description of what this ARN references */
  description: string;
  /** Whether this field has been confirmed in actual flows */
  confirmed: boolean;
}


export interface ActionTypeMapping {
  /** The action type as it appears in flow JSON */
  actionType: string;
  /** Human-readable name from Admin Guide */
  adminGuideName: string;
  /** List of ARN-containing field paths within Parameters */
  arnFields: ArnFieldPath[];
}


export const ARN_FIELD_MAPPINGS: ActionTypeMapping[] = [
  {
    actionType: "InvokeLambdaFunction",
    adminGuideName: "AWS Lambda function",
    arnFields: [
      { path: "LambdaFunctionARN", description: "Lambda function ARN", confirmed: true }
    ]
  },
  {
    actionType: "CreateCase",
    adminGuideName: "Cases",
    arnFields: [
      { path: "CaseTemplateId", description: "Case template ID (not ARN)", confirmed: true }
    ]
  },
  {
    actionType: "GetParticipantInput",
    adminGuideName: "Get customer input",
    arnFields: [
      { path: "PromptId", description: "Prompt ARN for audio playback", confirmed: true },
      { path: "LexBot", description: "Lex bot ARN (field name unconfirmed)", confirmed: false }
    ]
  },
  {
    actionType: "MessageParticipant",
    adminGuideName: "Play prompt",
    arnFields: [
      { path: "PromptId", description: "Prompt ARN", confirmed: true },
      { path: "Media.Uri", description: "S3 URI for audio files", confirmed: true }
    ]
  },
  {
    actionType: "UpdateContactEventHooks",
    adminGuideName: "Set customer queue flow / Set disconnect flow / Set whisper flow",
    arnFields: [
      { path: "EventHooks.CustomerQueue", description: "Customer queue flow ARN", confirmed: true },
      { path: "EventHooks.CustomerRemaining", description: "Customer remaining flow ARN", confirmed: true },
      { path: "EventHooks.AgentWhisper", description: "Agent whisper flow ARN", confirmed: true },
      { path: "EventHooks.DisconnectFlow", description: "Disconnect flow ARN", confirmed: false }
    ]
  },
  {
    actionType: "UpdateContactTargetQueue",
    adminGuideName: "Set working queue",
    arnFields: [
      { path: "QueueId", description: "Queue ARN", confirmed: true }
    ]
  },
  {
    actionType: "ShowView",
    adminGuideName: "Show view",
    arnFields: [
      { path: "ViewResource.Id", description: "View ARN (despite field name)", confirmed: true }
    ]
  },
  {
    actionType: "TransferToFlow",
    adminGuideName: "Transfer to flow",
    arnFields: [
      { path: "ContactFlowId", description: "Contact flow ARN", confirmed: true }
    ]
  },
  {
    actionType: "TransferContactToQueue",
    adminGuideName: "Transfer to queue",
    arnFields: [
      { path: "QueueId", description: "Queue ARN", confirmed: false }
    ]
  },
  {
    actionType: "InvokeFlowModule",
    adminGuideName: "Invoke module",
    arnFields: [
      { path: "ContactFlowModuleId", description: "Flow module ARN", confirmed: false }
    ]
  },
  {
    actionType: "CreateWisdomSession",
    adminGuideName: "Amazon Q in Connect",
    arnFields: [
      { path: "WisdomDomainArn", description: "Amazon Q domain ARN (field name unconfirmed)", confirmed: false }
    ]
  },
  {
    actionType: "AuthenticateParticipant",
    adminGuideName: "Authenticate Customer",
    arnFields: [
      { path: "CognitoConfiguration.UserPoolId", description: "Cognito User Pool ARN", confirmed: false },
      { path: "CognitoConfiguration.AppClientId", description: "Cognito App Client ID", confirmed: false }
    ]
  },
  {
    actionType: "StartOutboundEmailContact",
    adminGuideName: "Send message",
    arnFields: [
      // Email addresses are present but phone number ARN field name is unknown
      // Flow ARN reference field is also unknown
    ]
  }
];


/**
 * Get ARN field paths for a specific action type
 */
export function getArnFieldsForActionType(actionType: string): ArnFieldPath[] {
  const mapping = ARN_FIELD_MAPPINGS.find(m => m.actionType === actionType);
  return mapping?.arnFields ?? [];
}


/**
 * Check if an action type is known to contain ARNs
 */
export function actionTypeContainsArns(actionType: string): boolean {
  const fields = getArnFieldsForActionType(actionType);
  return fields.length > 0;
}
