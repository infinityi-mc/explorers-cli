import { runCli } from "./cli";

const result = await runCli({ stdout: process.stdout, stderr: process.stderr });

if (result.kind === "exit") {
  process.exit(result.code);
}

await result.app.done;
