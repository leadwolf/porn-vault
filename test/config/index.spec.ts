import "mocha";

import { assert } from "chai";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import sinon from "sinon";
import YAML from "yaml";

import {
  getConfig,
  checkConfig,
  resetLoadedConfig,
  watchConfig,
  findAndLoadConfig,
} from "../../src/config";
import defaultConfig from "../../src/config/default";
import { preserve } from "./index.fixture";
import { invalidConfig } from "./schema.fixture";
import { IConfig } from "../../src/config/schema";

const configJSONFilename = path.resolve("config.test.json");
const configYAMLFilename = path.resolve("config.test.yaml");

let exitStub = null as sinon.SinonStub | null;

let stopFileWatcher: (() => Promise<void>) | undefined;

describe("config", () => {
  before(() => {
    // Stub the exit so we can actually test
    exitStub = sinon.stub(process, "exit");
  });

  beforeEach(async () => {
    // By default, we do not want any config file
    for (const configFilename of [configJSONFilename, configYAMLFilename]) {
      if (existsSync(configFilename)) {
        unlinkSync(configFilename);
      }
      assert.isFalse(existsSync(configFilename));
    }
  });

  afterEach(() => {
    // reset the stub after each test
    if (exitStub) {
      (<any>exitStub).resetHistory();
    }

    // Reset the loaded config after each test
    // so it will not influence the next one
    resetLoadedConfig();
  });

  after(() => {
    if (exitStub) {
      (<any>exitStub).restore();
      exitStub = null;
    }
  });

  afterEach(async () => {
    // Cleanup for other tests
    for (const configFilename of [configJSONFilename, configYAMLFilename]) {
      if (existsSync(configFilename)) {
        unlinkSync(configFilename);
      }
      assert.isFalse(existsSync(configFilename));
    }

    if (stopFileWatcher) {
      await stopFileWatcher();
      stopFileWatcher = undefined;
    }
  });

  it("default config is falsy", () => {
    assert.isFalse(!!getConfig());
  });

  describe("findAndLoadConfig, checkConfig", () => {
    it("if no file found, writes config.test.json and exits", async () => {
      assert.isFalse(!!getConfig());
      assert.isFalse(existsSync(configJSONFilename));
      assert.isFalse((<any>exitStub).called);

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      assert.isTrue(existsSync(configJSONFilename));
      assert.isTrue((<any>exitStub).called);
    });

    for (const targetFile of [configJSONFilename, configYAMLFilename]) {
      it(`does NOT exit with default config written to ${targetFile}`, async () => {
        assert.isFalse((<any>exitStub).called);

        let formatter;
        if (targetFile.includes(".json")) {
          formatter = preserve.json;
        } else if (targetFile.includes(".yaml")) {
          formatter = preserve.yaml;
        } else {
          throw new Error("could not get formatter for test");
        }

        assert.isFalse(!!getConfig());
        assert.isFalse(existsSync(configJSONFilename));
        assert.isFalse(existsSync(configYAMLFilename));

        writeFileSync(targetFile, formatter.stringify(defaultConfig), {
          encoding: "utf-8",
        });
        assert.isTrue(existsSync(targetFile));

        await findAndLoadConfig();
        checkConfig(getConfig(), true);

        assert.isFalse((<any>exitStub).called);
      });
    }

    for (const targetFile of [configJSONFilename, configYAMLFilename]) {
      it(`exits when ${targetFile} format`, async () => {
        assert.isFalse((<any>exitStub).called);

        let formatter;
        if (targetFile.includes(".json")) {
          formatter = preserve.json;
        } else if (targetFile.includes(".yaml")) {
          formatter = preserve.yaml;
        } else {
          throw new Error("could not get formatter for test");
        }

        assert.isFalse(!!getConfig());
        assert.isFalse(existsSync(configJSONFilename));
        assert.isFalse(existsSync(configYAMLFilename));

        writeFileSync(targetFile, formatter.stringify(invalidConfig), {
          encoding: "utf-8",
        });
        assert.isTrue(existsSync(targetFile));

        await findAndLoadConfig();
        checkConfig(getConfig(), true);

        assert.isTrue((<any>exitStub).called);
      });
    }

    it("loads existing config.test.json", async () => {
      assert.isFalse(!!getConfig());
      assert.isFalse(existsSync(configJSONFilename));

      const testConfig = {
        ...defaultConfig,
        log: {
          ...defaultConfig.log,
          maxSize: 1,
        },
      };

      writeFileSync(configJSONFilename, JSON.stringify(testConfig, null, 2), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      assert.deepEqual(testConfig, getConfig());
    });

    it("loads existing config.test.yaml", async () => {
      assert.isFalse(!!getConfig());
      assert.isFalse(existsSync(configJSONFilename));
      assert.isFalse(existsSync(configYAMLFilename));

      const testConfig = {
        ...defaultConfig,
        log: {
          ...defaultConfig.log,
          maxSize: 1,
        },
      };

      writeFileSync(configYAMLFilename, YAML.stringify(testConfig), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configYAMLFilename));

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      assert.deepEqual(testConfig, getConfig());
    });

    it("loads json before yaml", async () => {
      assert.isFalse(!!getConfig());
      assert.isFalse(existsSync(configJSONFilename));
      assert.isFalse(existsSync(configYAMLFilename));

      const jsonConfig = {
        ...defaultConfig,
        JSON: true,
      };
      const yamlConfig = {
        ...defaultConfig,
        YAML: true,
      };

      writeFileSync(configJSONFilename, JSON.stringify(jsonConfig, null, 2), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));
      writeFileSync(configYAMLFilename, YAML.stringify(yamlConfig), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configYAMLFilename));

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      const loadedConfig = getConfig();

      assert.deepEqual(jsonConfig, loadedConfig);
      assert.notDeepEqual(yamlConfig, loadedConfig);
    });

    it("reloads modified config.test.json without exiting", async () => {
      assert.isFalse(!!getConfig());
      assert.isFalse(existsSync(configJSONFilename));

      const initialTestConfig = {
        ...defaultConfig,
        log: {
          ...defaultConfig.log,
          maxSize: 1,
        },
      };

      writeFileSync(configJSONFilename, JSON.stringify(initialTestConfig, null, 2), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      // Loaded config should contain our extra prop
      assert.deepEqual(initialTestConfig, getConfig());

      stopFileWatcher = watchConfig();
      // 2s should be enough to setup watcher
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));

      const secondaryTestConfig = {
        ...getConfig(),
        SECOND_TEST: true,
      };
      writeFileSync(configJSONFilename, JSON.stringify(secondaryTestConfig), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));

      // 3s should be enough to detect file change and reload
      await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

      assert.deepEqual(secondaryTestConfig, getConfig());

      // Live reloading should not provoke an exit
      assert.isFalse((<any>exitStub).called);
    });

    it("does not use modified config.test.json if invalid schema, does not exit", async () => {
      assert.isFalse(!!getConfig());
      assert.isFalse(existsSync(configJSONFilename));

      const initialTestConfig = {
        ...defaultConfig,
        log: {
          ...defaultConfig.log,
          maxSize: 1,
        },
      };

      writeFileSync(configJSONFilename, JSON.stringify(initialTestConfig, null, 2), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      // Loaded config should contain our extra prop
      assert.deepEqual(initialTestConfig, getConfig());

      stopFileWatcher = watchConfig();
      // 2s should be enough to setup watcher
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));

      const secondaryTestConfig: IConfig = {
        ...getConfig(),
      };
      delete secondaryTestConfig.log;
      assert.notProperty(secondaryTestConfig, "log");

      writeFileSync(configJSONFilename, JSON.stringify(secondaryTestConfig), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));

      // 3s should be enough to detect file change and reload
      await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

      assert.property(getConfig(), "log");
      // Our new invalid config should not be loaded
      assert.notDeepEqual(secondaryTestConfig, getConfig());
      // Our initial config should still be used
      assert.deepEqual(initialTestConfig, getConfig());

      // Live reloading should not provoke an exit if schema invalid
      assert.isFalse((<any>exitStub).called);
    });

    it("loads modified config.test.json, exits when necessary configs are invalid", async () => {
      assert.isFalse(!!getConfig());
      assert.isFalse(existsSync(configJSONFilename));
      const nonExistingFile = path.resolve("fake_file");
      assert.isFalse(existsSync(nonExistingFile));

      const initialTestConfig = {
        ...defaultConfig,
        log: {
          ...defaultConfig.log,
          maxSize: 1,
        },
      };

      writeFileSync(configJSONFilename, JSON.stringify(initialTestConfig, null, 2), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      // Loaded config should contain our extra prop
      assert.deepEqual(initialTestConfig, getConfig());

      stopFileWatcher = watchConfig();
      // 2s should be enough to setup watcher
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));

      const secondaryTestConfig: IConfig = {
        ...initialTestConfig,
        binaries: {
          ...initialTestConfig.binaries,
          ffmpeg: nonExistingFile,
        },
      };

      writeFileSync(configJSONFilename, JSON.stringify(secondaryTestConfig), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configJSONFilename));

      // 3s should be enough to detect file change and reload
      await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

      // We cannot test that our config did NOT load, since we stubbed the exit

      // Live reloading SHOULD provoke an exit if necessary configs are invalid
      assert.isTrue((<any>exitStub).called);
    });

    it("reloads modified config.test.yaml without exiting", async () => {
      const initialTestConfig = {
        ...defaultConfig,
        log: {
          maxSize: 1,
        },
      };

      writeFileSync(configYAMLFilename, YAML.stringify(initialTestConfig), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configYAMLFilename));

      await findAndLoadConfig();
      checkConfig(getConfig(), true);

      assert.deepEqual(initialTestConfig, getConfig());

      stopFileWatcher = watchConfig();
      // 2s should be enough to setup watcher
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));

      const secondaryTestConfig = {
        ...initialTestConfig,
        log: {
          ...initialTestConfig.log,
          maxSize: 2,
        },
      };
      writeFileSync(configYAMLFilename, YAML.stringify(secondaryTestConfig), {
        encoding: "utf-8",
      });
      assert.isTrue(existsSync(configYAMLFilename));

      // 3s should be enough to detect file change and reload
      await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

      assert.deepEqual(secondaryTestConfig, getConfig());

      // Live reloading should not provoke an exit
      assert.isFalse((<any>exitStub).called);
    });
  });
});
