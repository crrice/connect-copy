#!/usr/bin/env node

import { Command } from "commander";
import { copyFlows } from "./copy-flows.js";

const program = new Command();

program
  .name("connect-flow-copy")
  .description("Copy contact flows and flow modules between Amazon Connect instances")
  .version("1.0.0")
  .requiredOption("--source-config <path>", "Path to source configuration file")
  .requiredOption("--target-config <path>", "Path to target configuration file")
  .requiredOption("--source-profile <profile>", "AWS profile for source account")
  .requiredOption("--target-profile <profile>", "AWS profile for target account")
  .option("--no-publish", "Keep all flows as SAVED regardless of source state")
  .option("--verbose", "Enable detailed logging", false)
  .action(copyFlows);

program.parse();

