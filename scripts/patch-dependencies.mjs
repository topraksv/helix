// Upstream fixes applied to installed dependencies until their release ships.
// Runs on every install. A dependency whose text no longer matches fails the
// install: check whether the fix shipped, then drop or redo the patch.
import { readFileSync, writeFileSync } from "node:fs";

const PATCHES = [
  {
    // expo/expo#49778: a tab switch that interrupts a fade left the new tab
    // detached at opacity 0 (measured 2026-09-15, iOS Release, 5 runs of 6).
    file: "node_modules/expo-router/build/react-navigation/bottom-tabs/views/BottomTabView.js",
    edits: [
      [
        "    const tabAnims = (0, useAnimatedHashMap_1.useAnimatedHashMap)(state);\n",
        "    const tabAnims = (0, useAnimatedHashMap_1.useAnimatedHashMap)(state);\n" +
          "    const [lastUpdate, setLastUpdate] = React.useState({ current: focusedRouteKey, animating: false });\n" +
          "    if (lastUpdate.current !== focusedRouteKey) {\n" +
          "        setLastUpdate({ current: focusedRouteKey, previous: lastUpdate.current, animating: true });\n" +
          "    }\n",
      ],
      [
        "        let popToTopAction;\n",
        "        let popToTopAction;\n        let timer;\n",
      ],
      [
        "                if (finished && popToTopAction) {\n                    navigation.dispatch(popToTopAction);\n                }\n",
        "                if (finished && popToTopAction) {\n                    navigation.dispatch(popToTopAction);\n                }\n" +
          "                if (finished) {\n" +
          "                    timer = setTimeout(() => setLastUpdate((update) => update.animating ? { ...update, animating: false } : update), 32);\n" +
          "                }\n",
      ],
      [
        "        previousRouteKeyRef.current = focusedRouteKey;\n",
        "        previousRouteKeyRef.current = focusedRouteKey;\n        return () => clearTimeout(timer);\n",
      ],
      [
        "                        : animationEnabled // is animation is not enabled, immediately move to inactive state\n" +
          "                            ? tabAnims[route.key].interpolate({\n" +
          "                                inputRange: [0, 1 - EPSILON, 1],\n" +
          "                                outputRange: [\n" +
          "                                    STATE_TRANSITIONING_OR_BELOW_TOP, // screen visible during transition\n" +
          "                                    STATE_TRANSITIONING_OR_BELOW_TOP,\n" +
          "                                    STATE_INACTIVE, // the screen is detached after transition\n" +
          "                                ],\n" +
          "                                extrapolate: 'extend',\n" +
          "                            })\n",
        "                        : animationEnabled && lastUpdate.animating && (lastUpdate.previous === route.key || lastUpdate.current === route.key)\n" +
          "                            ? STATE_TRANSITIONING_OR_BELOW_TOP\n",
      ],
    ],
  },
];

for (const { file, edits } of PATCHES) {
  let text = readFileSync(file, "utf8");
  if (edits.every(([, after]) => text.includes(after))) continue;
  for (const [before, after] of edits) {
    if (text.split(before).length !== 2) throw new Error(`${file} no longer matches its patch; check whether the upstream fix shipped.`);
    text = text.replace(before, after);
  }
  writeFileSync(file, text);
}
