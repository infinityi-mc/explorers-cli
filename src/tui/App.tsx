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

      {viewModel.banner === undefined ? null : (
        <box marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>{viewModel.banner}</text>
        </box>
      )}

      <box flexDirection="row" flexGrow={1} gap={1}>
        <box border flexGrow={1} padding={1} flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Servers</text>
          {viewModel.servers.length === 0 ? <text attributes={TextAttributes.DIM}>none configured</text> : null}
          {viewModel.servers.map((server) => (
            <text key={server.id}>
              {server.id}: {server.state}{server.pid === undefined ? "" : ` pid=${server.pid}`}{server.pendingRestart ? " pending-restart" : ""}
            </text>
          ))}
        </box>
        <box border flexGrow={1} padding={1} flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Logs</text>
          {viewModel.servers[0] === undefined ? null : (
            <text attributes={TextAttributes.DIM}>
              buffer {viewModel.servers[0].bufferBytes}/{viewModel.servers[0].bufferCapacityBytes} | dropped {viewModel.servers[0].dropped} | evicted {viewModel.servers[0].evicted}
            </text>
          )}
          {viewModel.logs.length === 0 ? <text attributes={TextAttributes.DIM}>no scrollback</text> : null}
          {viewModel.logs.map((line, index) => <text key={`${index}-${line}`}>{line}</text>)}
        </box>
        <box border flexGrow={1} padding={1} flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Chat</text>
          <text attributes={TextAttributes.DIM}>waiting for later-phase data</text>
        </box>
        <box border flexGrow={1} padding={1} flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Commands</text>
          <text attributes={TextAttributes.DIM}>waiting for later-phase data</text>
        </box>
      </box>
    </box>
  );
}
