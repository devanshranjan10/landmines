import { Command } from 'commander';
import { VERSION } from './version.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('landmine')
    .description('Open bugs filed against your exact dependency versions, surfaced before your agent edits the code that hits them.')
    .version(VERSION, '-v, --version');
  return program;
}

await buildProgram().parseAsync(process.argv);
