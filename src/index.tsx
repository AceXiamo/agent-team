#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';

import { MessageRouter } from './core/router.js';
import { createDefaultRegistry } from './drivers/index.js';
import { App } from './tui/App.js';

const router = await MessageRouter.create({
  workdir: process.cwd(),
  registry: createDefaultRegistry()
});

const app = render(<App router={router} />);

const cleanup = async (): Promise<void> => {
  await router.dispose();
  app.unmount();
};

process.on('SIGTERM', () => {
  void cleanup();
});
