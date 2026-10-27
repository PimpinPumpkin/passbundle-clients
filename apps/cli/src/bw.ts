import "core-js/proposals/explicit-resource-management";

import { program } from "commander";

import { CLI_BRAND } from "./keykeeper/brand";
import { applyBrandEnvironment } from "./keykeeper/env";
import { OssServeConfigurator } from "./oss-serve-configurator";
import { registerOssPrograms } from "./register-oss-programs";
import { ServeProgram } from "./serve.program";
import { ServiceContainer } from "./service-container/service-container";

async function main() {
  // Keykeeper: the brand's environment variables and command name
  // (keykeeper/env.ts), before anything reads either.
  applyBrandEnvironment();
  program.name(CLI_BRAND.command);

  const serviceContainer = new ServiceContainer();
  await serviceContainer.init();

  await registerOssPrograms(serviceContainer);

  // ServeProgram is registered separately so it can be overridden by bit-cli
  const serveConfigurator = new OssServeConfigurator(serviceContainer);
  new ServeProgram(serviceContainer, serveConfigurator).register();

  program.parse(process.argv);
}

// Node does not support top-level await statements until ES2022, esnext, etc which we don't use yet
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
