const { withInfoPlist, withXcodeProject } = require("@expo/config-plugins");

const NATIVE_PRODUCT_NAME = "HelixNative";

function unquote(value) {
  return typeof value === "string" ? value.replace(/^\"|\"$/g, "") : value;
}

/**
 * Keep the user-facing name while avoiding a case-insensitive collision between
 * the iOS executable and Expo Router's /helix asset directory.
 */
function withIosNativeProductName(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.CFBundleName = config.name;
    return config;
  });

  return withXcodeProject(config, (config) => {
    const bundleIdentifier = config.ios?.bundleIdentifier;
    const configurations = config.modResults.pbxXCBuildConfigurationSection();

    for (const configuration of Object.values(configurations)) {
      const settings = configuration?.buildSettings;
      if (!settings || unquote(settings.PRODUCT_BUNDLE_IDENTIFIER) !== bundleIdentifier) {
        continue;
      }

      settings.PRODUCT_NAME = NATIVE_PRODUCT_NAME;
    }

    return config;
  });
}

module.exports = withIosNativeProductName;
