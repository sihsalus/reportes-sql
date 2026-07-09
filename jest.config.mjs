/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^(\\.{1,2}/.*)\\.ts$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.test.json",
      },
    ],
    "^.+\\.js$": "ts-jest",
  },
  transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
  clearMocks: true,
  extensionsToTreatAsEsm: [".ts"],
  globalSetup: "<rootDir>/tests/jest-no-focused.mjs",
};
