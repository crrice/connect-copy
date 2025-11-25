
import type { SecurityProfileSummary, SecurityProfile } from "@aws-sdk/client-connect";

import * as CliUtil from "../../utils/cli-utils.js";
import { listSecurityProfiles } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeSecurityProfile, listSecurityProfilePermissions } from "./operations.js";

import { compareHierarchyGroups, type HierarchyGroupComparisonResult } from "../hierarchy-groups/report.js";


export type SecurityProfileWithPermissions = NoUndefinedVals<SecurityProfile> & {
  SecurityProfileName: string;
  Permissions: string[];
};


export interface SecurityProfileAction {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";

  profileName: string;
  sourceProfile: SecurityProfileWithPermissions;
  targetProfile?: SecurityProfileWithPermissions;
}


export interface SecurityProfileComparisonResult {
  actions: SecurityProfileAction[];
  profiles: SecurityProfileSummary[];

  hierarchyGroups: HierarchyGroupComparisonResult
}

export async function compareSecurityProfiles(config: CliUtil.ResourceComparisonConfig): Promise<SecurityProfileComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const sourceProfiles = await listSecurityProfiles(sourceClient, sourceInstanceId);
  const targetProfiles = await listSecurityProfiles(targetClient, targetInstanceId);

  // TODO: Verify that the match function returns true when filters is undefined.
  // TODO: Change the name since its used for more than just flows.
  // TODO: Idea? Modify so nna is not needed, should fail all items with undefined names.
  const filteredSourceProfiles = sourceProfiles.filter(profile => matchesFlowFilters(profile.Name!, filterConfig));

  // Going to need this to compare profiles (should they have hg permissions configured).
  const hierarchyGroups = await compareHierarchyGroups({ sourceClient, targetClient, sourceInstanceId, targetInstanceId, filterConfig: undefined });

  const targetProfilesByName: Record<string, typeof targetProfiles[0]> = Object.fromEntries(targetProfiles.map(profile => [profile.Name, profile]));
  const actions: SecurityProfileAction[] = [];

  const unresolvedProfiles: SecurityProfile[] = [];

  for (const sourceSummary of filteredSourceProfiles) {

    const sourceProfile = await describeSecurityProfile(sourceClient, sourceInstanceId, sourceSummary.Id!);
    const sourcePermissions = await listSecurityProfilePermissions(sourceClient, sourceInstanceId, sourceSummary.Id!);

    // Verify HG mapping will be possible:
    if (sourceProfile.AllowedAccessControlHierarchyGroupId) {
      const mapping = hierarchyGroups.groupMapping[sourceProfile.AllowedAccessControlHierarchyGroupId];
      if (!mapping?.targetId) {
        // In this case, it is simply not possible to update this profile and the tool should not allow
        // the user to execute. Additionally the follow on checks below (like content matches) will have
        // issues when the hg id cannot be resolved. So:
        unresolvedProfiles.push(sourceProfile);
        continue;
      }
    }

    const sourceProfileWithPermissions = {
      ...sourceProfile,
      Permissions: sourcePermissions
    };

    const targetProfileSummary = targetProfilesByName[sourceSummary.Name!];

    if (!targetProfileSummary) {
      actions.push({
        profileName: sourceSummary.Name!,
        action: "create",
        sourceProfile: sourceProfileWithPermissions
      });

      continue;
    }

    const targetProfile = await describeSecurityProfile(targetClient, targetInstanceId, targetProfileSummary.Id!);
    const targetPermissions = await listSecurityProfilePermissions(targetClient, targetInstanceId, targetProfileSummary.Id!);

    const targetProfileWithPermissions = {
      ...targetProfile,
      Permissions: targetPermissions
    };

    const contentMatches = securityProfileContentMatches(sourceProfileWithPermissions, targetProfileWithPermissions, hierarchyGroups);
    const tagsMatch = CliUtil.recordsMatch(sourceProfile.Tags, targetProfile.Tags);

    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : !tagsMatch ? "update_tags"
      : "skip";

    actions.push({
      profileName: sourceSummary.Name!,
      action: actionType,
      sourceProfile: sourceProfileWithPermissions,
      targetProfile: targetProfileWithPermissions
    });
  }

  const comparisonResult = {
    actions,
    profiles: filteredSourceProfiles,
    hierarchyGroups,
  }

  if (unresolvedProfiles.length) {
    comparisonResult.actions = [];

    console.log("\n⚠️  Validation Error: Cannot copy security profiles\n");
    console.log("The following security profiles reference hierarchy groups that don't exist in the target instance:\n");

    for (const item of unresolvedProfiles) {
      const hgName = hierarchyGroups.groupMapping[item.AllowedAccessControlHierarchyGroupId!]?.name;
      console.log(`  - "${item.SecurityProfileName}" → Hierarchy Group: "${hgName}"`);
    }

    console.log("\nTo resolve this issue:");
    console.log("  • Create these hierarchy groups in the target instance, OR");
    console.log("  • Exclude these security profiles using filters in your source config\n");
  }

  return comparisonResult;
}


function securityProfileContentMatches(source: SecurityProfileWithPermissions, target: SecurityProfileWithPermissions, hierarchyGroups: HierarchyGroupComparisonResult): boolean {

  // Basic info matches:
  if (source.Description !== target.Description) return false;
  if (!CliUtil.arraysMatch(source.Permissions, target.Permissions)) return false;

  // Tag based access info matches (or mutually unconfigured):
  if (!CliUtil.recordsMatch(source.AllowedAccessControlTags, target.AllowedAccessControlTags)) return false;
  if (!CliUtil.arraysMatch(source.TagRestrictedResources, target.TagRestrictedResources)) return false;

  // Hierarchy based access info matches (or mutually unconfigured):
  if (!CliUtil.arraysMatch(source.HierarchyRestrictedResources, target.HierarchyRestrictedResources)) return false;

  // If hierarchy group IDs differ, verify the source maps to the correct target ID by name.
  if (source.AllowedAccessControlHierarchyGroupId !== target.AllowedAccessControlHierarchyGroupId) {
    const sourceHgInfo = hierarchyGroups.groupMapping[source.AllowedAccessControlHierarchyGroupId!];
    if (sourceHgInfo?.targetId !== target.AllowedAccessControlHierarchyGroupId) return false;
  }

  return true;
}


export function getSecurityProfileDiff(source: SecurityProfileWithPermissions, target: SecurityProfileWithPermissions, hierarchyGroups: HierarchyGroupComparisonResult): string[] {
  const diffs: string[] = [];

  if (source.Description !== target.Description) {
    const sourceDesc = source.Description ?? "(none)";
    const targetDesc = target.Description ?? "(none)";
    diffs.push(`Description: ${targetDesc} → ${sourceDesc}`);
  }

  if (!CliUtil.arraysMatch(source.Permissions, target.Permissions)) {
    diffs.push(`Permissions: ${target.Permissions.length} → ${source.Permissions.length} permissions`);
  }

  // TODO: verbose mode log which tags specifically change and not just the count?
  // TODO: Tag handling is the same for most resources, can abstract?
  if (!CliUtil.recordsMatch(source.AllowedAccessControlTags, target.AllowedAccessControlTags)) {
    const sourceCount = source.AllowedAccessControlTags ? Object.keys(source.AllowedAccessControlTags).length : 0;
    const targetCount = target.AllowedAccessControlTags ? Object.keys(target.AllowedAccessControlTags).length : 0;
    diffs.push(`AllowedAccessControlTags: ${targetCount} → ${sourceCount} tags`);
  }

  if (!CliUtil.arraysMatch(source.TagRestrictedResources, target.TagRestrictedResources)) {
    const sourceCount = source.TagRestrictedResources?.length ?? 0;
    const targetCount = target.TagRestrictedResources?.length ?? 0;
    diffs.push(`TagRestrictedResources: ${targetCount} → ${sourceCount} resources`);
  }

  if (!CliUtil.arraysMatch(source.HierarchyRestrictedResources, target.HierarchyRestrictedResources)) {
    const sourceCount = source.HierarchyRestrictedResources?.length ?? 0;
    const targetCount = target.HierarchyRestrictedResources?.length ?? 0;
    diffs.push(`HierarchyRestrictedResources: ${targetCount} → ${sourceCount} resources`);
  }

  // This checks by id, good if both are unconfigured, but if they are we also have to check by name.
  // If the source has a hg config, then the target should have the associated target id.
  if (source.AllowedAccessControlHierarchyGroupId !== target.AllowedAccessControlHierarchyGroupId) {

    const sourceHgInfo = hierarchyGroups.groupMapping[source.AllowedAccessControlHierarchyGroupId!];
    if (sourceHgInfo?.targetId !== target.AllowedAccessControlHierarchyGroupId) {
      const sourceId = source.AllowedAccessControlHierarchyGroupId ?? "(none)";
      const targetId = target.AllowedAccessControlHierarchyGroupId ?? "(none)";
      diffs.push(`AllowedAccessControlHierarchyGroupId: ${targetId} → ${sourceId} (${sourceHgInfo?.name})`);
    }
  }

  return diffs;
}


export function displaySecurityProfilePlan(comparisonResult: SecurityProfileComparisonResult, verbose: boolean) {
  const toCreate = comparisonResult.actions.filter(a => a.action === "create");
  const toUpdateAll = comparisonResult.actions.filter(a => a.action === "update_all");
  const toUpdateData = comparisonResult.actions.filter(a => a.action === "update_data");
  const toUpdateTags = comparisonResult.actions.filter(a => a.action === "update_tags");
  const toSkip = comparisonResult.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Security profiles to create: ${toCreate.length}`);
  console.log(`  Security profiles to update (all): ${toUpdateAll.length}`);
  console.log(`  Security profiles to update (data only): ${toUpdateData.length}`);
  console.log(`  Security profiles to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Security profiles to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${comparisonResult.profiles.length}`);

  if (toCreate.length > 0) {
    console.log(`\nSecurity profiles to create:`);
    for (const profileOp of toCreate) {
      console.log(`  - ${profileOp.profileName}`);
      if (verbose) {
        const profile = profileOp.sourceProfile;
        if (profile.Description) console.log(`      Description: ${profile.Description}`);
        console.log(`      Permissions: ${profileOp.sourceProfile.Permissions.length}`);
        if (profile.AllowedAccessControlHierarchyGroupId) {
          console.log(`      AllowedAccessControlHierarchyGroupId: ${profile.AllowedAccessControlHierarchyGroupId}`);
        }
        if (profile.Tags && Object.keys(profile.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(profile.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdateAll.length > 0) {
    console.log(`\nSecurity profiles to update (all):`);
    for (const profileOp of toUpdateAll) {
      console.log(`  - ${profileOp.profileName}`);
      if (verbose && profileOp.targetProfile) {
        const diffs = getSecurityProfileDiff(profileOp.sourceProfile, profileOp.targetProfile, comparisonResult.hierarchyGroups);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateData.length > 0) {
    console.log(`\nSecurity profiles to update (data only):`);
    for (const profileOp of toUpdateData) {
      console.log(`  - ${profileOp.profileName}`);
      if (verbose && profileOp.targetProfile) {
        const diffs = getSecurityProfileDiff(profileOp.sourceProfile, profileOp.targetProfile, comparisonResult.hierarchyGroups);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nSecurity profiles to update (tags only):`);
    for (const profileOp of toUpdateTags) {
      console.log(`  - ${profileOp.profileName}`);
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nSecurity profiles to skip (identical):`);
    for (const profileOp of toSkip) {
      console.log(`  - ${profileOp.profileName}`);
    }
  }
}



