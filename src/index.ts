#!/usr/bin/env node

import { Command } from "commander";
import { setCliFlags } from "./cli-flags.js";
import { copyFlows } from "./copy-flows.js";
import { copyViews } from "./copy-views.js";
import { copyAgentStatuses } from "./resources/agent-statuses/copy.js";
import { copyHoursOfOperations } from "./resources/hours-of-operation/copy.js";
import { copyHierarchyGroups } from "./resources/hierarchy-groups/copy.js";
import { copySecurityProfiles } from "./resources/security-profiles/copy.js";
import { runReport } from "./report.js";

const program = new Command();

program
  .name("connect-flow-copy")
  .description("Copy contact flows and flow modules between Amazon Connect instances")
  .version("1.0.0");

program
  .command("copy")
  .description("Copy contact flows and flow modules between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--no-publish", "Keep all flows as SAVED regardless of source state")
  .option("-y, --yes", "Auto-confirm all prompts", false)
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: options.publish, yes: options.yes, verbose: options.verbose });
    copyFlows(options);
  });

program
  .command("report")
  .description("Report resource differences between source and target instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--resources-only", "Only report resource differences, skip flow validation", false)
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    runReport(options);
  });

program
  .command("copy-views")
  .description("Copy views between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--include-aws-managed", "Include AWS managed views", false)
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copyViews(options);
  });

program
  .command("copy-agent-statuses")
  .description("Copy agent statuses between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copyAgentStatuses(options);
  });

program
  .command("copy-hours-of-operation")
  .description("Copy hours of operation between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copyHoursOfOperations(options);
  });

program
  .command("copy-hierarchy-groups")
  .description("Copy user hierarchy groups between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--force-hierarchy-recreate", "Allow deleting and recreating groups with parent mismatches", false)
  .option("--force-structure-update", "Allow overwriting target hierarchy structure if it differs from source", false)
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copyHierarchyGroups(options);
  });

program
  .command("copy-security-profiles")
  .description("Copy security profiles between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copySecurityProfiles(options);
  });

program.parse();

