#!/usr/bin/env node

import { CLIApplication } from './cli/app';

// Main entry point
const app = new CLIApplication();
app.run();