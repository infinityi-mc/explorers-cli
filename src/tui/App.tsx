import { TextAttributes } from "@opentui/core";
import type { AppViewModel } from "./view-model";

export function App({ viewModel }: { readonly viewModel: AppViewModel }) {
  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexDirection="column" marginBottom={1}>
        <ascii-font font="tiny" text={viewModel.title} />
        <text attributes={TextAttributes.DIM}>
          mode: {viewModel.mode} | config: {viewModel.configStatus} |{" "}
          {viewModel.configPath}
        </text>
      </box>

      <box gap={2} marginBottom={1}>
        <text>servers: {viewModel.serverCount}</text>
        <text>agents: {viewModel.agentCount}</text>
        <text>providers: {viewModel.providerCount}</text>
      </box>

      <box flexDirection="row" flexGrow={1} gap={1}>
        {viewModel.panels.map((panel) => (
          <box
            key={panel}
            border
            flexGrow={1}
            padding={1}
            flexDirection="column"
          >
            <text attributes={TextAttributes.BOLD}>{panel}</text>
            <text attributes={TextAttributes.DIM}>
              waiting for later-phase data
            </text>
          </box>
        ))}
      </box>
    </box>
  );
}
