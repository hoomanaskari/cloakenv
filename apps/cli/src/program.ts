import { Command } from "commander";
import { registerAuditCommand } from "./commands/audit";
import { registerConfigCommand } from "./commands/config";
import { registerExportCommand } from "./commands/export";
import { registerGeneratePassphraseCommand } from "./commands/generate-passphrase";
import { registerGetCommand } from "./commands/get";
import { registerHistoryCommand } from "./commands/history";
import { registerImportCommand } from "./commands/import-cmd";
import { registerInitCommand } from "./commands/init";
import { registerListCommand } from "./commands/list";
import { registerProjectCommand } from "./commands/project";
import { registerProviderCommand } from "./commands/provider";
import { registerRemoveCommand } from "./commands/remove";
import { registerRunCommand } from "./commands/run";
import { registerSchemaCommand } from "./commands/schema";
import { registerSetCommand } from "./commands/set";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("cloakenv")
    .description("Your secrets, invisible to AI. Encrypted local vault for developer secrets.")
    .version("0.1.0");

  registerInitCommand(program);
  registerSetCommand(program);
  registerGetCommand(program);
  registerListCommand(program);
  registerRemoveCommand(program);
  registerRunCommand(program);
  registerExportCommand(program);
  registerImportCommand(program);
  registerHistoryCommand(program);
  registerAuditCommand(program);
  registerConfigCommand(program);
  registerProviderCommand(program);
  registerProjectCommand(program);
  registerSchemaCommand(program);
  registerGeneratePassphraseCommand(program);

  return program;
}
