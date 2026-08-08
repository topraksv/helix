const { withInfoPlist, withPodfile, withXcodeProject } = require("expo/config-plugins");

const NATIVE_PRODUCT_NAME = "HelixNative";
const SQLITE_HEADER_SEARCH_PATH = "$(PODS_ROOT)/Headers/Public/ExpoSQLite";
const SQLITE_POST_INSTALL_MARKER = "# Helix: keep ExpoSQLite's vendored C header visible to Swift";

function unquote(value) {
  return typeof value === "string" ? value.replace(/^\"|\"$/g, "") : value;
}

function withExpoSqliteHeaderSearchPath(config) {
  return withPodfile(config, (config) => {
    const { contents } = config.modResults;
    if (contents.includes(SQLITE_POST_INSTALL_MARKER)) {
      return config;
    }

    const postInstall = "  post_install do |installer|\n";
    if (!contents.includes(postInstall)) {
      throw new Error("Helix requires the standard iOS post_install hook to configure ExpoSQLite.");
    }

    const patch = [
      `    ${SQLITE_POST_INSTALL_MARKER}`,
      "    # CocoaPods omits this public path on Xcode 26, so Swift can resolve the SDK's sqlite3.h instead.",
      "    installer.pods_project.targets.each do |target|",
      "      next unless target.name == 'ExpoSQLite'",
      "",
      "      target.build_configurations.each do |configuration|",
      "        header_search_paths = configuration.build_settings['HEADER_SEARCH_PATHS'] || '$(inherited)'",
      `        next if header_search_paths.include?('${SQLITE_HEADER_SEARCH_PATH}')`,
      "",
      "        configuration.build_settings['HEADER_SEARCH_PATHS'] =",
      `          \"#{header_search_paths} ${SQLITE_HEADER_SEARCH_PATH}\"`,
      "      end",
      "    end",
      "",
    ].join("\n");

    config.modResults.contents = contents.replace(postInstall, `${postInstall}${patch}`);
    return config;
  });
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

  config = withExpoSqliteHeaderSearchPath(config);

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
