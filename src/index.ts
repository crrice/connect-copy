#!/usr/bin/env node

import { Command } from "commander";
import { setCliFlags } from "./cli-flags.js";
import { copyFlows } from "./copy-flows.js";
import { copyViews } from "./resources/views/copy.js";
import { copyAgentStatuses } from "./resources/agent-statuses/copy.js";
import { copyHoursOfOperations } from "./resources/hours-of-operation/copy.js";
import { copyHierarchyGroups } from "./resources/hierarchy-groups/copy.js";
import { copySecurityProfiles } from "./resources/security-profiles/copy.js";
import { copyQueues } from "./resources/queues/copy.js";
import { copyRoutingProfiles } from "./resources/routing-profiles/copy.js";
import { copyQuickConnects } from "./resources/quick-connects/copy.js";
import { copyAll } from "./copy-all.js";
import { runReport } from "./report.js";

const program = new Command();

program
  .name("connect-copy")
  .description("Copy contact flows and supporting resources between Amazon Connect instances")
  .version("0.2.1");

program
  .command("copy-flows")
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
  .command("copy")
  .description("Copy all resource types between instances in dependency order")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--skip <resources>", "Comma-separated resource types to skip (e.g. flows,queues)", "")
  .option("--skip-outbound-flow", "Skip outbound whisper flow configuration for queues", false)
  .option("--force-hierarchy-recreate", "Allow deleting and recreating hierarchy groups with parent mismatches", false)
  .option("--force-structure-update", "Allow overwriting target hierarchy structure if it differs from source", false)
  .option("--no-publish", "Keep all flows as SAVED regardless of source state")
  .option("-y, --yes", "Auto-confirm all prompts", false)
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: options.publish, yes: options.yes, verbose: options.verbose });
    copyAll(options);
  });

program
  .command("copy-views")
  .description("Copy views between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
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

program
  .command("copy-queues")
  .description("Copy queues between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--skip-outbound-flow", "Skip outbound whisper flow configuration", false)
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copyQueues(options);
  });

program
  .command("copy-routing-profiles")
  .description("Copy routing profiles between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copyRoutingProfiles(options);
  });

program
  .command("copy-quick-connects")
  .description("Copy quick connects between instances")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--verbose", "Enable detailed logging", false)
  .action((options) => {
    setCliFlags({ publish: true, yes: false, verbose: options.verbose });
    copyQuickConnects(options);
  });

program.parse();

