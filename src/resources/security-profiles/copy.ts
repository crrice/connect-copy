
import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";

import { createSecurityProfile, updateSecurityProfile } from "./operations.js";
import { compareSecurityProfiles, getSecurityProfileDiff, displaySecurityProfilePlan } from "./report.js";

import type { ConnectClient } from "@aws-sdk/client-connect";
import type { SecurityProfileComparisonResult, SecurityProfileAction } from "./report.js";
import type { HierarchyGroupComparisonResult } from "../hierarchy-groups/report.js";


export interface CopySecurityProfilesOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
}


export async function copySecurityProfiles(options: CopySecurityProfilesOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  console.log("\nAnalyzing security profile differences...");
  const comparisonResult = await compareSecurityProfiles({
    sourceClient,
    targetClient,
    sourceInstanceId: config.source.instanceId,
    targetInstanceId: config.target.instanceId,
    filterConfig: config.source.securityProfileFilters
  });

  displaySecurityProfilePlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo security profiles need to be copied - all profiles match");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying security profiles?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying security profiles...");
  await executeSecurityProfileCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose);
}


async function executeSecurityProfileCopy(targetClient: ConnectClient, targetInstanceId: string, comparisonResult: SecurityProfileComparisonResult, verbose: boolean) {

  const toSkip = comparisonResult.actions.filter(op => op.action === "skip");
  const toCreate = comparisonResult.actions.filter(op => op.action === "create");
  const toUpdate = comparisonResult.actions.filter(op => ["update_data", "update_all"].includes(op.action));
  const toTag = comparisonResult.actions.filter(op => ["update_tags", "update_all"].includes(op.action));

  for (const createOp of toCreate) {
    logProfileCreate(createOp, verbose);

    const config = { ...createOp.sourceProfile };
    if (createOp.sourceProfile.AllowedAccessControlHierarchyGroupId) {
      config.AllowedAccessControlHierarchyGroupId = comparisonResult.hierarchyGroups.groupMapping[createOp.sourceProfile.AllowedAccessControlHierarchyGroupId]!.targetId!;
    }

    await createSecurityProfile(targetClient, targetInstanceId, config);
  }

  for (const updateOp of toUpdate) {
    logProfileUpdate(updateOp, comparisonResult.hierarchyGroups, verbose);

    const config = { ...updateOp.sourceProfile };
    if (updateOp.sourceProfile.AllowedAccessControlHierarchyGroupId) {
      config.AllowedAccessControlHierarchyGroupId = comparisonResult.hierarchyGroups.groupMapping[updateOp.sourceProfile.AllowedAccessControlHierarchyGroupId]!.targetId!;
    }

    await updateSecurityProfile(targetClient, targetInstanceId, updateOp.targetProfile?.Id!, config);
  }


  for (const tagOp of toTag) {
    logTagsUpdate(tagOp, verbose);

    const { toAdd, toRemove } = CliUtil.getRecordDiff(tagOp.sourceProfile.Tags, tagOp.targetProfile?.Tags);
    await AwsUtil.updateResourceTags(targetClient, tagOp.targetProfile?.Arn!, toAdd, toRemove);
  }

  console.log(`\nCopy complete: ${toCreate.length} created, ${toUpdate.length} data updated, ${toTag.length} tags updated, ${toSkip.length} skipped`);
  logManualConfigurationWarning();
}


function logProfileCreate(profileOp: SecurityProfileAction, verbose: boolean) {
  console.log(`Creating security profile: ${profileOp.profileName}`);
  if (!verbose) return;

  const profile = profileOp.sourceProfile;

  if (profile.Description) console.log(`  Description: ${profile.Description}`);
  console.log(`  AllowedAccessControlHierarchyGroupId: ${profile.AllowedAccessControlHierarchyGroupId ?? "(none)"}`);
  console.log(`  Permissions: ${!profile.Permissions ? "(none)" : profile.Permissions.map(s => `    ${s}`).join("\n")}`);
  console.log(`  Tags: ${!profile.Tags ? "(none)" : Object.entries(profile.Tags).map(([k, v]) => `    ${k}=${v}`).join("\n")}`);
}


function logProfileUpdate(profileOp: SecurityProfileAction, hierarchyGroups: HierarchyGroupComparisonResult, verbose: boolean) {
  console.log(`Updating security profile: ${profileOp.profileName}`);
  if (!verbose || !profileOp.targetProfile) return;

  const diffs = getSecurityProfileDiff(profileOp.sourceProfile, profileOp.targetProfile, hierarchyGroups);
  console.log(`  Diffs: ${diffs.join("\n    ")}`);
}

function logTagsUpdate(profileOp: SecurityProfileAction, verbose: boolean) {
  console.log(`Updating tags for security profile: ${profileOp.profileName}`);
  if (!verbose) return;

  console.log(`  Tags: ${!profileOp.sourceProfile.Tags ? "(none)" : Object.entries(profileOp.sourceProfile.Tags).map(([k, v]) => `    ${k}=${v}`).join("\n")}`);
}


function logManualConfigurationWarning() {
  console.log("\n" + "=".repeat(72));
  console.log("⚠️  IMPORTANT: MANUAL CONFIGURATION REQUIRED");
  console.log("=".repeat(72));
  console.log("\nThe APPLICATIONS field cannot be copied via AWS API.");
  console.log("You must manually review and configure application permissions");
  console.log("for each security profile in the AWS Connect Console.");
  console.log("\n" + "=".repeat(72));
}
