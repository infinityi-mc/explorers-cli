import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import type { AppViewModel } from "./view-model";

export type StopTui = () => void;
export type StartTui = (viewModel: AppViewModel) => Promise<StopTui>;

export async function startTui(viewModel: AppViewModel): Promise<StopTui> {
  const renderer = await createCliRenderer();
  const root = createRoot(renderer);
  root.render(<App viewModel={viewModel} />);

  return () => {
    root.unmount();
    renderer.destroy();
  };
}

export { App } from "./App";
export { createAppViewModel } from "./view-model";
export type { AppViewModel } from "./view-model";
