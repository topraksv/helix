// Drizzle migrations import .sql files; expo-sqlite web ships a wasm asset.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("sql");
config.resolver.assetExts.push("wasm");

module.exports = config;
